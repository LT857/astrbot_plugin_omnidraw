"""图片 Provider 工厂。"""

import aiohttp
from ..models import ProviderConfig
from ..constants import APIType
from .base import BaseProvider
from .unified_image_impl import UnifiedImageProvider

def create_provider(config: ProviderConfig, session: aiohttp.ClientSession) -> BaseProvider:
    """根据配置实例化 Provider。所有图片节点统一走同一套请求逻辑。"""
    if config.api_type in {
        APIType.OPENAI_IMAGE,
        APIType.OPENAI_CHAT,
        APIType.GEMINI_OFFICIAL,
        APIType.CUSTOM_ENDPOINT,
    }:
        return UnifiedImageProvider(config, session)
    raise NotImplementedError(f"暂不支持该类型的接口: {config.api_type}")
