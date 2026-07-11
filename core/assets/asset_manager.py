"""
asset_manager — 中央资产注册表
===============================
类似 Unity 的 AssetDatabase。
管理 UI 布局资产、纹理、主题等资源的注册、加载与生命周期。

核心类:
    AssetManager — 单例式资产管理器

功能:
    - register(name, data)     注册资产
    - get(name) → AssetInfo    获取资产
    - load_json(path) → dict   加载 JSON 文件
    - unload(name)             卸载资产
    - list_assets() → list     列出所有资产
    - clear()                  清空全部
"""

import json
from pathlib import Path
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

from core.logger import get_logger

logger = get_logger('assets.manager')


# ──────────────────────────────────────────────
# 资产类型枚举
# ──────────────────────────────────────────────

class AssetType(Enum):
    """支持的资产类型"""
    LAYOUT = 'layout'          # UI 布局 JSON
    THEME = 'theme'            # 主题配置
    TEXTURE = 'texture'        # 纹理/图片
    SCRIPT = 'script'          # Python 脚本模块
    DATA = 'data'              # 通用数据 JSON
    CONFIG = 'config'          # 配置 JSON


# ──────────────────────────────────────────────
# 资产信息数据类
# ──────────────────────────────────────────────

@dataclass
class AssetInfo:
    """单个资产的信息"""
    name: str                           # 资产唯一名称
    asset_type: AssetType               # 资产类型
    data: Any                           # 资产数据 (dict / list / str ...)
    source_path: Optional[Path] = None  # 来源文件路径
    metadata: dict = field(default_factory=dict)  # 额外元数据

    @property
    def display_name(self) -> str:
        """显示名称: 优先用 metadata 中的 name"""
        return self.metadata.get('name', self.name)

    def __repr__(self):
        return f'<AssetInfo "{self.name}" [{self.asset_type.value}]>'


# ──────────────────────────────────────────────
# AssetManager
# ──────────────────────────────────────────────

class AssetManager:
    """中央资产管理器

    用法:
        mgr = AssetManager()

        # 注册资产
        mgr.register('main_menu', layout_data, AssetType.LAYOUT)

        # 获取资产
        asset = mgr.get('main_menu')
        if asset:
            build_ui(asset.data)

        # 从 JSON 文件加载
        asset = mgr.load_from_json('assets/layouts/main_menu.json')
    """

    def __init__(self):
        self._assets: dict[str, AssetInfo] = {}
        self._aliases: dict[str, str] = {}  # 别名 → 正式名称
        logger.info('AssetManager 初始化')

    # ─── 注册 ───

    def register(
        self,
        name: str,
        data: Any,
        asset_type: AssetType = AssetType.DATA,
        source_path: Path = None,
        metadata: dict = None,
    ) -> AssetInfo:
        """注册一个资产

        Parameters
        ----------
        name : str
            资产唯一名称
        data : Any
            资产数据
        asset_type : AssetType
            资产类型, 默认 DATA
        source_path : Path, optional
            来源文件路径
        metadata : dict, optional
            额外元数据

        Returns
        -------
        AssetInfo
            已注册的资产信息
        """
        info = AssetInfo(
            name=name,
            asset_type=asset_type,
            data=data,
            source_path=source_path,
            metadata=metadata or {},
        )
        self._assets[name] = info
        logger.debug('注册资产: {} [{}]', name, asset_type.value)
        return info

    def register_alias(self, alias: str, target: str):
        """注册别名"""
        if target not in self._assets:
            raise KeyError(f'目标资产 "{target}" 不存在')
        self._aliases[alias] = target

    # ─── 获取 ───

    def get(self, name: str) -> Optional[AssetInfo]:
        """获取已注册的资产"""
        if name in self._assets:
            return self._assets[name]
        if name in self._aliases:
            return self._assets.get(self._aliases[name])
        return None

    def get_data(self, name: str) -> Optional[Any]:
        """直接获取资产数据"""
        asset = self.get(name)
        return asset.data if asset else None

    def __contains__(self, name: str) -> bool:
        return name in self._assets or name in self._aliases

    def __getitem__(self, name: str) -> AssetInfo:
        asset = self.get(name)
        if asset is None:
            raise KeyError(f'资产 "{name}" 未注册')
        return asset

    # ─── JSON 加载 ───

    def load_from_json(
        self,
        path: str | Path,
        asset_type: AssetType = AssetType.LAYOUT,
    ) -> Optional[AssetInfo]:
        """从 JSON 文件加载并注册资产

        Parameters
        ----------
        path : str | Path
            JSON 文件路径
        asset_type : AssetType
            资产类型

        Returns
        -------
        AssetInfo
            注册后的资产, 加载失败返回 None
        """
        path = Path(path)
        if not path.exists():
            logger.error('文件不存在: {}', path)
            return None

        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except json.JSONDecodeError as e:
            logger.error('JSON 解析失败 ({}): {}', path, e)
            return None
        except OSError as e:
            logger.error('文件读取失败 ({}): {}', path, e)
            return None

        # 从 metadata 中提取名称
        name = path.stem  # 默认用文件名 (不含扩展名)
        metadata = data.get('metadata', {}) if isinstance(data, dict) else {}
        if isinstance(metadata, dict) and 'name' in metadata:
            name = metadata['name']

        return self.register(
            name=name,
            data=data,
            asset_type=asset_type,
            source_path=path.resolve(),
            metadata=metadata,
        )

    def load_from_json_str(
        self,
        name: str,
        json_str: str,
        asset_type: AssetType = AssetType.LAYOUT,
    ) -> Optional[AssetInfo]:
        """从 JSON 字符串加载并注册资产"""
        try:
            data = json.loads(json_str)
        except json.JSONDecodeError as e:
            logger.error('JSON 解析失败: {}', e)
            return None

        metadata = data.get('metadata', {}) if isinstance(data, dict) else {}
        return self.register(
            name=name,
            data=data,
            asset_type=asset_type,
            metadata=metadata,
        )

    # ─── 卸载 ───

    def unload(self, name: str) -> bool:
        """卸载指定资产"""
        if name in self._assets:
            del self._assets[name]
            logger.debug('卸载资产: {}', name)
            return True
        if name in self._aliases:
            del self._aliases[name]
            return True
        return False

    # ─── 查询 ───

    def list_assets(
        self,
        asset_type: AssetType = None,
    ) -> list[AssetInfo]:
        """列出所有已注册的资产

        Parameters
        ----------
        asset_type : AssetType, optional
            筛选特定类型, None 返回全部

        Returns
        -------
        list[AssetInfo]
            资产列表
        """
        assets = list(self._assets.values())
        if asset_type:
            assets = [a for a in assets if a.asset_type == asset_type]
        return sorted(assets, key=lambda a: a.name)

    def count(self, asset_type: AssetType = None) -> int:
        """资产数量"""
        return len(self.list_assets(asset_type))

    def find_by_metadata(self, key: str, value: Any) -> list[AssetInfo]:
        """按元数据字段查找资产"""
        return [
            a for a in self._assets.values()
            if a.metadata.get(key) == value
        ]

    def clear(self):
        """清空所有资产"""
        self._assets.clear()
        self._aliases.clear()
        logger.info('AssetManager 已清空')

    def __len__(self) -> int:
        return len(self._assets)

    def __repr__(self):
        n = len(self._assets)
        return f'<AssetManager: {n} 个资产 ({sum(1 for _ in self._assets.values() if _.asset_type == AssetType.LAYOUT)} 布局)>'
