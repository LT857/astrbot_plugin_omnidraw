"""Unified image request provider based on the reference page request flow."""

import asyncio
import base64
import json
import math
import os
import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote, urlparse

import aiohttp
from astrbot.api import logger

from ..constants import APIType, DEFAULT_GEMINI_BASE_URL, DEFAULT_GEMINI_MODEL
from .base import (
    BaseProvider,
    build_chat_completions_endpoint,
    build_image_edits_endpoint,
    build_image_generations_endpoint,
    extract_error_message,
    extract_image_url_from_response,
    guess_image_content_type,
    is_complete_endpoint_url,
    normalize_base_url,
    summarize_payload_json_for_log,
    summarize_response_text_for_log,
    summarize_text_for_log,
    summarize_url_for_log,
)


MAX_REFERENCE_IMAGES = 14
ALLOWED_ASPECT_RATIOS = (
    "1:1",
    "3:4",
    "4:3",
    "9:16",
    "16:9",
    "2:3",
    "3:2",
    "4:5",
    "5:4",
    "21:9",
    "1:4",
    "4:1",
    "1:8",
    "8:1",
)
INTERNAL_KWARGS = {"user_refs", "user_ref", "persona_refs", "persona_ref"}
REQUEST_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/149.0.0.0 Safari/537.36"
)


class UnifiedImageProvider(BaseProvider):
    """One request pipeline for OpenAI-style, Gemini, custom and proxy image APIs."""

    async def _get_image_bytes(self, image_path_or_url: str) -> bytes:
        source = str(image_path_or_url or "").strip()
        if source.startswith("data:image"):
            try:
                return base64.b64decode(source.split(",", 1)[1], validate=False)
            except Exception as exc:
                raise RuntimeError(f"Base64 参考图解析失败: {exc}")
        if source.startswith("http"):
            logger.info("📥 [统一图片通道] 正在下载网络参考图并转码...")
            headers = {"User-Agent": REQUEST_USER_AGENT}
            async with self.session.get(source, headers=headers) as response:
                if response.status != 200:
                    raise RuntimeError(f"参考图下载失败，服务器返回状态码: {response.status}")
                return await response.read()
        if not os.path.exists(source):
            raise RuntimeError(f"本地参考图不存在: {source}")
        with open(source, "rb") as file:
            return file.read()

    async def _encode_image_to_data_url(self, image_path_or_url: str) -> str:
        image_bytes = await self._get_image_bytes(image_path_or_url)
        mime_type = guess_image_content_type(image_path_or_url)
        return f"data:{mime_type};base64," + base64.b64encode(image_bytes).decode("utf-8")

    async def _inline_image_part(self, image_path_or_url: str) -> Dict[str, Any]:
        image_bytes = await self._get_image_bytes(image_path_or_url)
        return {
            "inlineData": {
                "mimeType": guess_image_content_type(image_path_or_url),
                "data": base64.b64encode(image_bytes).decode("ascii"),
            }
        }

    def _pop_any(self, params: Dict[str, Any], *names: str) -> Any:
        for name in names:
            if name in params:
                return params.pop(name)
        return None

    def _request_model(self, params: Dict[str, Any]) -> str:
        default_model = DEFAULT_GEMINI_MODEL if self.config.api_type == APIType.GEMINI_OFFICIAL else self.config.model
        model = str(params.pop("model", "") or default_model or "").strip()
        if self.config.api_type == APIType.GEMINI_OFFICIAL and model.startswith("models/"):
            return model.split("/", 1)[1]
        return model

    def _endpoint_path(self, endpoint: str) -> str:
        return urlparse(endpoint).path.rstrip("/").lower()

    def _gemini_endpoint(self, model: str) -> str:
        base_url = normalize_base_url(self.config.base_url) or DEFAULT_GEMINI_BASE_URL
        if ":generateContent" in base_url:
            return base_url
        if "/models/" in base_url:
            return f"{base_url}:generateContent"
        if base_url.endswith("/models"):
            base_url = base_url[: -len("/models")]
        return f"{base_url}/models/{quote(model, safe='-._~')}:generateContent"

    def _endpoint(self, has_refs: bool) -> str:
        if self.config.api_type == APIType.GEMINI_OFFICIAL:
            return ""
        if self.config.api_type == APIType.CUSTOM_ENDPOINT:
            endpoint = str(self.config.base_url or "").strip()
            if not is_complete_endpoint_url(endpoint):
                raise ValueError(
                    "自定义节点必须填写完整请求路径，例如 "
                    "https://api.example.com/v1/images/generations，不能只填域名或 /v1。"
                )
            return endpoint
        if self.config.api_type == APIType.OPENAI_CHAT:
            return build_chat_completions_endpoint(self.config.base_url)
        return build_image_edits_endpoint(self.config.base_url) if has_refs else build_image_generations_endpoint(self.config.base_url)

    def _aspect_ratio_from_size(self, value: Any) -> str:
        match = re.fullmatch(r"\s*(\d+)\s*[xX×]\s*(\d+)\s*", str(value or ""))
        if not match:
            return ""
        width, height = int(match.group(1)), int(match.group(2))
        if width <= 0 or height <= 0:
            return ""
        ratio = width / height
        return min(
            ALLOWED_ASPECT_RATIOS,
            key=lambda item: abs(math.log(ratio / (int(item.split(":")[0]) / int(item.split(":")[1])))),
        )

    def _image_size_from_size(self, value: Any) -> str:
        text = str(value or "").strip().upper()
        if re.fullmatch(r"\d+(?:\.\d+)?K", text):
            return text
        official_format = self._parse_official_image_format(value)
        if official_format.get("image_size"):
            return official_format["image_size"]
        match = re.fullmatch(r"\s*(\d+)\s*[xX×]\s*(\d+)\s*", text)
        if not match:
            return ""
        max_side = max(int(match.group(1)), int(match.group(2)))
        if max_side <= 1024:
            return "1K"
        if max_side <= 2048:
            return "2K"
        return "4K"

    def _normalize_gemini_aspect_ratio(self, value: Any) -> str:
        return self._normalize_aspect_ratio_text(value) or self._aspect_ratio_from_size(value) or str(value or "").strip()

    def _normalize_modalities(self, value: Any) -> List[str]:
        raw_items = value if isinstance(value, (list, tuple)) else re.split(r"[\s,]+", str(value or ""))
        items = []
        for item in raw_items:
            text = str(item or "").strip().upper()
            if text:
                items.append("IMAGE" if text == "IMG" else text)
        return items or ["TEXT", "IMAGE"]

    def _apply_gemini_image_options(self, params: Dict[str, Any]) -> None:
        configured_aspect = self._configured_aspect_ratio()
        if configured_aspect:
            self._pop_any(params, "aspectRatio", "aspect_ratio")
            params["aspect_ratio"] = self._normalize_gemini_aspect_ratio(configured_aspect)

        configured_size = self._configured_image_size()
        if configured_size:
            self._pop_any(params, "size", "imageSize", "image_size")
            official_format = self._parse_official_image_format(configured_size)
            if self._configured_resolution_mode() == "official" and official_format:
                if official_format.get("aspect_ratio") and not configured_aspect:
                    params["aspect_ratio"] = official_format["aspect_ratio"]
                if official_format.get("image_size"):
                    params["image_size"] = official_format["image_size"]
            elif self._aspect_ratio_from_size(configured_size):
                params["size"] = configured_size
            else:
                params["image_size"] = configured_size

    def _build_gemini_generation_config(self, params: Dict[str, Any]) -> Dict[str, Any]:
        modalities = self._pop_any(params, "responseModalities", "response_modalities")
        generation_config: Dict[str, Any] = {
            "responseModalities": self._normalize_modalities(modalities or ["TEXT", "IMAGE"])
        }

        for source_key, target_key in (
            ("temperature", "temperature"),
            ("topP", "topP"),
            ("top_p", "topP"),
            ("topK", "topK"),
            ("top_k", "topK"),
            ("candidateCount", "candidateCount"),
            ("candidate_count", "candidateCount"),
            ("maxOutputTokens", "maxOutputTokens"),
            ("max_output_tokens", "maxOutputTokens"),
            ("seed", "seed"),
        ):
            if source_key in params:
                generation_config[target_key] = params.pop(source_key)

        raw_size = self._pop_any(params, "size")
        raw_size_format = self._parse_official_image_format(raw_size)
        aspect_ratio = self._pop_any(params, "aspectRatio", "aspect_ratio")
        if not aspect_ratio:
            aspect_ratio = raw_size_format.get("aspect_ratio") or self._aspect_ratio_from_size(raw_size)
        image_size = self._pop_any(params, "imageSize", "image_size")
        if not image_size:
            image_size = raw_size_format.get("image_size") or self._image_size_from_size(raw_size)

        image_options: Dict[str, str] = {}
        if aspect_ratio:
            image_options["aspectRatio"] = self._normalize_gemini_aspect_ratio(aspect_ratio)
        if image_size:
            image_options["imageSize"] = str(image_size).strip().upper()
        if image_options:
            generation_config["imageConfig"] = image_options
        return generation_config

    def _build_gemini_top_level_overrides(self, params: Dict[str, Any]) -> Dict[str, Any]:
        top_level = {}
        for source_key, target_key in (
            ("safetySettings", "safetySettings"),
            ("safety_settings", "safetySettings"),
            ("systemInstruction", "systemInstruction"),
            ("system_instruction", "systemInstruction"),
        ):
            if source_key in params:
                top_level[target_key] = params.pop(source_key)
        return top_level

    def _openai_size_from_aspect_ratio(self, value: Any) -> str:
        text = self._normalize_aspect_ratio_text(value)
        match = re.fullmatch(r"(\d+):(\d+)", text or "")
        if not match:
            return ""
        width = float(match.group(1))
        height = float(match.group(2))
        ratio = width / height
        model = str(self.config.model or "").lower()
        if abs(ratio - 1.0) <= 0.08:
            return "1024x1024"
        if "dall-e-3" in model:
            return "1792x1024" if ratio > 1 else "1024x1792"
        return "1536x1024" if ratio > 1 else "1024x1536"

    def _openai_size_from_value(self, value: Any, *, official_mode: bool = True) -> str:
        text = str(value or "").strip()
        official_format = self._parse_official_image_format(text)
        if official_format.get("aspect_ratio"):
            return self._openai_size_from_aspect_ratio(official_format["aspect_ratio"])
        if official_format.get("image_size") and official_mode:
            return "1024x1024"
        if official_mode:
            pixel_match = re.fullmatch(r"\s*(\d+)\s*[xX×]\s*(\d+)\s*", text)
            if pixel_match:
                width = int(pixel_match.group(1))
                height = int(pixel_match.group(2))
                model = str(self.config.model or "").lower()
                known_sizes = {"1024x1024", "auto"}
                if "dall-e-3" in model:
                    known_sizes.update({"1792x1024", "1024x1792"})
                else:
                    known_sizes.update({"1536x1024", "1024x1536"})
                normalized_size = f"{width}x{height}"
                if normalized_size in known_sizes:
                    return normalized_size
                return self._openai_size_from_aspect_ratio(f"{width}:{height}")
        return self._openai_size_from_aspect_ratio(text) or text

    def _apply_openai_image_options(self, params: Dict[str, Any]) -> None:
        configured_size = self._configured_image_size()
        configured_aspect = self._configured_aspect_ratio()
        official_mode = self._configured_resolution_mode() == "official"
        explicit_size = self._pop_any(params, "size", "image_size", "imageSize")
        explicit_aspect = self._pop_any(params, "aspect_ratio", "aspectRatio")

        if configured_size:
            params["size"] = self._openai_size_from_value(configured_size, official_mode=official_mode)
            return
        if configured_aspect:
            size = self._openai_size_from_aspect_ratio(configured_aspect)
            if size:
                params["size"] = size
            return
        if explicit_size:
            params["size"] = self._openai_size_from_value(explicit_size, official_mode=False)
            return
        size = self._openai_size_from_aspect_ratio(explicit_aspect)
        if size:
            params["size"] = size

    def _prepare_api_kwargs(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        params = {key: value for key, value in kwargs.items() if key not in INTERNAL_KWARGS}
        if self.config.api_type == APIType.GEMINI_OFFICIAL:
            self._apply_gemini_image_options(params)
        elif self.config.api_type == APIType.OPENAI_IMAGE:
            self._apply_openai_image_options(params)
        else:
            self.apply_configured_image_defaults(params)
        return params

    def _image_size(self, params: Dict[str, Any]) -> str:
        size = str(params.get("size") or params.get("image_size") or params.get("imageSize") or "").strip()
        return size or "1024x1024"

    def _pixel_size(self, image_size: str) -> Tuple[int, int]:
        match = re.search(r"(\d+)\s*[xX×]\s*(\d+)", str(image_size or ""))
        if not match:
            return 1024, 1024
        return max(1, int(match.group(1))), max(1, int(match.group(2)))

    def _fast_prompt(self, prompt: str) -> str:
        text = re.sub(r"\s+", " ", str(prompt or "")).strip()
        if len(text) <= 900:
            return text
        return text[:900].rsplit(" ", 1)[0] or text[:900]

    def _image_json_payload(
        self,
        endpoint: str,
        prompt: str,
        encoded_images: List[str],
        params: Dict[str, Any],
    ) -> Dict[str, Any]:
        endpoint_lower = endpoint.lower()
        image_size = self._image_size(params)
        width, height = self._pixel_size(image_size)
        prompt_text = str(prompt or "")

        if "stability" in endpoint_lower:
            for key in ("size", "image_size", "imageSize", "aspect_ratio", "aspectRatio"):
                params.pop(key, None)
            payload: Dict[str, Any] = {
                "text_prompts": [{"text": prompt_text, "weight": 1}],
                "steps": 30,
                "samples": int(params.pop("n", 1) or 1),
            }
            if encoded_images:
                payload["init_image"] = encoded_images[0].split(",", 1)[-1]
                payload["image_strength"] = params.pop("image_strength", 0.45)
            payload.update(params)
            return payload

        if any(marker in endpoint_lower for marker in ("sd", "comfyui", "webui", "automatic", "img2img")):
            for key in ("size", "image_size", "imageSize", "aspect_ratio", "aspectRatio"):
                params.pop(key, None)
            payload = {
                "prompt": prompt_text,
                "negative_prompt": params.pop(
                    "negative_prompt",
                    "blurry, low quality, distorted, ugly, bad anatomy, watermark, text",
                ),
                "steps": params.pop("steps", 30),
                "cfg_scale": params.pop("cfg_scale", 7),
                "width": width,
                "height": height,
                "sampler_name": params.pop("sampler_name", "Euler a"),
            }
            if encoded_images:
                payload["init_images"] = [image.split(",", 1)[-1] for image in encoded_images]
                payload["denoising_strength"] = params.pop("denoising_strength", 0.55)
            payload.update(params)
            return payload

        if "replicate" in endpoint_lower:
            payload = {"input": {"prompt": prompt_text}}
            if encoded_images:
                payload["input"]["image"] = encoded_images[0]
                payload["input"]["strength"] = params.pop("strength", 0.55)
            payload["input"].update(params)
            return payload

        if "midjourney" in endpoint_lower or "discord" in endpoint_lower:
            payload = {"prompt": prompt_text}
            if encoded_images:
                payload["image"] = encoded_images[0]
            payload.update(params)
            return payload

        if endpoint_lower.endswith("/chat/completions"):
            content: List[Dict[str, Any]] = []
            for image in encoded_images:
                content.append({"type": "image_url", "image_url": {"url": image}})
            content.append({"type": "text", "text": prompt_text})
            payload = {"model": self.config.model, "messages": [{"role": "user", "content": content}]}
            payload.update(params)
            return payload

        if endpoint_lower.endswith("/responses"):
            content: List[Dict[str, Any]] = [{"type": "input_text", "text": prompt_text}]
            for image in encoded_images:
                content.append({"type": "input_image", "image_url": image})
            payload = {
                "model": self.config.model,
                "input": [{"role": "user", "content": content}] if encoded_images else prompt_text,
                "tools": [{"type": "image_generation"}],
            }
            payload.update(params)
            return payload

        payload = {
            "model": self.config.model,
            "prompt": prompt_text,
            "n": int(params.pop("n", 1) or 1),
            "size": image_size,
        }
        for index, image in enumerate(encoded_images[:3]):
            payload["image" if index == 0 else f"image{index + 1}"] = image
        payload.update(params)
        return payload

    async def _build_gemini_payload(self, prompt: str, ref_images: List[str], params: Dict[str, Any]) -> Tuple[str, Dict[str, str], Dict[str, Any]]:
        if len(ref_images) > MAX_REFERENCE_IMAGES:
            raise ValueError(f"Gemini 官方接口最多支持 {MAX_REFERENCE_IMAGES} 张参考图。")
        model = self._request_model(params)
        if not model:
            raise ValueError("Gemini 官方节点未配置模型名！")
        endpoint = self._gemini_endpoint(model)
        parts: List[Dict[str, Any]] = [{"text": str(prompt or "")}]
        for index, ref_image in enumerate(ref_images, start=1):
            try:
                parts.append(await self._inline_image_part(ref_image))
            except Exception as exc:
                raise RuntimeError(f"读取第 {index} 张参考图数据失败: {exc}")
        payload = {
            "contents": [{"parts": parts}],
            "generationConfig": self._build_gemini_generation_config(params),
        }
        payload.update(self._build_gemini_top_level_overrides(params))
        if params:
            logger.info(f"ℹ️ [统一图片通道] 已忽略非 Gemini 官方参数: {', '.join(sorted(params))}")
        return endpoint, {
            "Content-Type": "application/json",
            "User-Agent": REQUEST_USER_AGENT,
            "x-goog-api-key": self.get_current_key(),
        }, payload

    async def _encoded_reference_images(self, ref_images: List[str]) -> List[str]:
        encoded_images = []
        for index, ref_image in enumerate(ref_images, start=1):
            try:
                encoded_images.append(await self._encode_image_to_data_url(ref_image))
            except Exception as exc:
                raise RuntimeError(f"读取第 {index} 张参考图数据失败: {exc}")
        return encoded_images

    async def _build_edits_form(
        self,
        prompt: str,
        ref_images: List[str],
        params: Dict[str, Any],
        *,
        prompt_override: Optional[str] = None,
        size_override: Optional[str] = None,
    ) -> aiohttp.FormData:
        data = aiohttp.FormData()
        data.add_field("model", str(params.pop("model", "") or self.config.model))
        data.add_field("prompt", str(prompt_override if prompt_override is not None else prompt or ""))
        data.add_field("n", str(params.pop("n", 1) or 1))
        data.add_field("size", str(size_override or self._image_size(params)))
        for key in ("size", "image_size", "imageSize"):
            params.pop(key, None)
        if "quality" not in params:
            data.add_field("quality", "low")
        for index, ref_image in enumerate(ref_images, start=1):
            try:
                image_bytes = await self._get_image_bytes(ref_image)
            except Exception as exc:
                raise RuntimeError(f"读取第 {index} 张参考图数据失败: {exc}")
            data.add_field(
                "image",
                image_bytes,
                filename=f"reference_{index}.png",
                content_type=guess_image_content_type(ref_image),
            )
        for key, value in params.items():
            data.add_field(key, str(value))
        return data

    async def _post(
        self,
        endpoint: str,
        headers: Dict[str, str],
        *,
        payload: Any = None,
        form_data: Any = None,
        timeout_seconds: Optional[float] = None,
    ) -> Tuple[int, str]:
        timeout_obj = aiohttp.ClientTimeout(total=timeout_seconds or self.config.timeout)
        if form_data is not None:
            async with self.session.post(endpoint, data=form_data, headers=headers, timeout=timeout_obj) as response:
                return response.status, await response.text()
        async with self.session.post(endpoint, json=payload, headers=headers, timeout=timeout_obj) as response:
            return response.status, await response.text()

    def _parse_image_response(self, status: int, text: str, endpoint: str) -> str:
        if status >= 400:
            logger.error("💥 统一图片通道 API 返回错误摘要: " + summarize_response_text_for_log(text, max_string_length=500))
            raise RuntimeError(f"HTTP {status}: {extract_error_message(text)}")
        try:
            payload = json.loads(text)
        except Exception:
            payload = text
        image_url = extract_image_url_from_response(payload, endpoint)
        if image_url:
            return image_url
        if isinstance(payload, (dict, list, tuple)):
            summary = summarize_payload_json_for_log(payload, max_string_length=500)
        else:
            summary = summarize_text_for_log(str(payload), max_string_length=500)
        raise ValueError("API 返回结构异常，未找到图片数据: " + summary)

    async def _send_gemini(self, prompt: str, ref_images: List[str], params: Dict[str, Any]) -> str:
        endpoint, headers, payload = await self._build_gemini_payload(prompt, ref_images, params)
        logger.info(f"📤 [统一图片通道/Gemini] 请求路径: {summarize_url_for_log(endpoint)}")
        logger.info(f"📤 [统一图片通道/Gemini] 请求体摘要: {summarize_payload_json_for_log(payload)}")
        status, text = await self._post(endpoint, headers, payload=payload)
        return self._parse_image_response(status, text, endpoint)

    async def _send_image_request(self, prompt: str, ref_images: List[str], params: Dict[str, Any]) -> str:
        endpoint = self._endpoint(bool(ref_images))
        endpoint_path = self._endpoint_path(endpoint)
        headers = {
            "Authorization": "Bearer " + self.get_current_key(),
            "User-Agent": REQUEST_USER_AGENT,
        }

        if endpoint_path.endswith("/images/edits") and not ref_images:
            raise ValueError("/images/edits 请求需要至少一张参考图。")

        if ref_images and endpoint_path.endswith("/images/edits"):
            attempts = [{"label": "标准请求", "prompt": prompt, "size": self._image_size(params)}]
            fast_prompt = self._fast_prompt(prompt)
            if "jojocode.com" in endpoint.lower():
                attempts = [
                    {"label": "jojocode 快速请求", "prompt": fast_prompt, "size": "auto"},
                    {"label": "512x512 降级重试", "prompt": fast_prompt, "size": "512x512"},
                ]
            else:
                attempts.append({"label": "快速降级重试", "prompt": fast_prompt, "size": "512x512"})

            last_status = 0
            last_text = ""
            last_timeout: Optional[BaseException] = None
            for index, attempt in enumerate(attempts):
                attempt_params = dict(params)
                form_data = await self._build_edits_form(
                    prompt,
                    ref_images,
                    attempt_params,
                    prompt_override=attempt["prompt"],
                    size_override=attempt["size"],
                )
                logger.info(f"📤 [统一图片通道] {attempt['label']} multipart: {summarize_url_for_log(endpoint)}")
                timeout_cap = 180.0 if index == 0 else 120.0
                attempt_timeout = min(float(self.config.timeout or timeout_cap), timeout_cap)
                try:
                    status, text = await self._post(
                        endpoint,
                        headers,
                        form_data=form_data,
                        timeout_seconds=attempt_timeout,
                    )
                except asyncio.TimeoutError as exc:
                    last_timeout = exc
                    if index < len(attempts) - 1:
                        logger.warning("⚠️ 上游请求超时，自动降级尺寸/精简提示词重试。")
                        continue
                    raise RuntimeError("上游服务超时，请稍后重试或降低分辨率/参考图数量。") from exc
                if status != 524 or index == len(attempts) - 1:
                    return self._parse_image_response(status, text, endpoint)
                last_status, last_text = status, text
                logger.warning("⚠️ 上游 524 超时，自动降级尺寸/精简提示词重试。")
            if last_timeout:
                raise RuntimeError("上游服务超时，请稍后重试或降低分辨率/参考图数量。") from last_timeout
            return self._parse_image_response(last_status, last_text, endpoint)

        encoded_images = await self._encoded_reference_images(ref_images)
        headers["Content-Type"] = "application/json"
        payload = self._image_json_payload(endpoint, prompt, encoded_images, dict(params))
        logger.info(f"📤 [统一图片通道] 请求路径: {summarize_url_for_log(endpoint)}")
        logger.info(f"📤 [统一图片通道] 请求体摘要: {summarize_payload_json_for_log(payload)}")
        status, text = await self._post(endpoint, headers, payload=payload)
        return self._parse_image_response(status, text, endpoint)

    async def generate_image(self, prompt: str, **kwargs: Any) -> str:
        current_key = self.get_current_key()
        if not current_key:
            raise ValueError("节点未配置 API Key！")
        if self.config.api_type != APIType.GEMINI_OFFICIAL and not self.config.base_url:
            raise ValueError("节点未配置接口地址！")
        if self.config.api_type != APIType.GEMINI_OFFICIAL and not self.config.model:
            raise ValueError("节点未配置模型名！")

        ref_images = self.get_reference_images(**kwargs)
        params = self._prepare_api_kwargs(kwargs)
        logger.info(f"📝 [统一图片通道] 最终发送给 API 的核心提示词:\n{prompt}")

        if self.config.api_type == APIType.GEMINI_OFFICIAL:
            return await self._send_gemini(prompt, ref_images, params)
        return await self._send_image_request(prompt, ref_images, params)
