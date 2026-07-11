"""
layout_merger — 布局合并工具
============================
将多个布局片段合并到一起，支持覆盖和插入模式。
类似 Unity 的 UI Document 嵌套 + USS 样式覆盖。

用法:
    merger = LayoutMerger()

    # 合并两个文件
    merger.merge_file('base.json', 'overlay.json', 'merged.json')

    # 用 dict 合并
    result = merger.merge(base_dict, overlay_dict)

    # 插入布局片段到指定父节点
    merger.insert_into('base.json', 'assets/layouts/piece.json',
                       parent_id='main_win', output='result.json')
"""

import json
import copy
from pathlib import Path
from typing import Optional

from core.logger import get_logger

logger = get_logger('assets.tools.merger')


# ──────────────────────────────────────────────
# LayoutMerger
# ──────────────────────────────────────────────

class LayoutMerger:
    """布局合并器

    合并策略:
        - 相同 id 的节点: overlay 的属性覆盖 base, 子控件递归合并
        - overlay 中新增 id 的节点: 追加到 base
        - base 中有但 overlay 没有的节点: 保留
        - bindings: 合并 (overlay 覆盖)
        - variables: 合并 (overlay 覆盖)
        - metadata: overlay 覆盖 base
    """

    def merge(self, base: dict, overlay: dict) -> dict:
        """合并两个布局字典

        Parameters
        ----------
        base : dict
            基础布局
        overlay : dict
            覆盖布局 (优先级高)

        Returns
        -------
        dict
            合并后的布局
        """
        result = copy.deepcopy(base)

        # 合并 metadata
        if 'metadata' in overlay:
            result.setdefault('metadata', {}).update(overlay['metadata'])

        # 合并 variables
        if 'variables' in overlay:
            result.setdefault('variables', {}).update(overlay['variables'])

        # 合并 bindings
        if 'bindings' in overlay:
            result.setdefault('bindings', {}).update(overlay['bindings'])

        # 合并 UI 树
        if 'ui' in overlay:
            if 'ui' in result:
                self._merge_nodes(result['ui'], overlay['ui'])
            else:
                result['ui'] = copy.deepcopy(overlay['ui'])

        return result

    def _merge_nodes(self, base_node: dict, overlay_node: dict):
        """递归合并两个节点"""
        # overlay 的非 children 属性覆盖 base
        for key, value in overlay_node.items():
            if key == 'children':
                continue
            base_node[key] = copy.deepcopy(value)

        # 合并 children
        overlay_children = overlay_node.get('children', [])
        base_children = base_node.setdefault('children', [])

        # 建立 base 的 id→node 索引
        base_index: dict[str, dict] = {}
        for child in base_children:
            wid = child.get('id')
            if wid:
                base_index[wid] = child

        # 处理 overlay 的每个子节点
        handled_ids = set()
        for overlay_child in overlay_children:
            oid = overlay_child.get('id')
            if oid and oid in base_index:
                # 同 id → 递归合并
                self._merge_nodes(base_index[oid], overlay_child)
                handled_ids.add(oid)
            elif oid:
                # 新 id → 追加到 base
                base_children.append(copy.deepcopy(overlay_child))
                handled_ids.add(oid)

    # ─── 文件操作 ───

    def merge_file(self, base_path: str | Path, overlay_path: str | Path,
                   output_path: str | Path = None) -> dict:
        """合并两个布局文件

        Parameters
        ----------
        base_path : str | Path
            基础布局文件
        overlay_path : str | Path
            覆盖布局文件
        output_path : str | Path, optional
            输出路径, None 则不保存

        Returns
        -------
        dict
            合并后的布局
        """
        base = self._load_file(base_path)
        overlay = self._load_file(overlay_path)
        result = self.merge(base, overlay)

        if output_path:
            output_path = Path(output_path)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
            logger.info('合并完成: {} + {} → {}',
                        Path(base_path).name, Path(overlay_path).name,
                        output_path)

        return result

    def insert_into(self, target_path: str | Path, source_path: str | Path,
                    parent_id: str, output_path: str | Path = None) -> dict:
        """将 source 的所有子控件插入到 target 的指定父节点下

        Parameters
        ----------
        target_path : str | Path
            目标布局文件
        source_path : str | Path
            来源布局文件 (取其 ui.children)
        parent_id : str
            目标父节点 ID
        output_path : str | Path, optional
            输出路径
        """
        target = self._load_file(target_path)
        source = self._load_file(source_path)

        # 找到目标父节点
        def _find(node: dict, wid: str):
            if node.get('id') == wid:
                return node
            for child in node.get('children', []):
                r = _find(child, wid)
                if r:
                    return r
            return None

        parent_node = _find(target.get('ui', {}), parent_id)
        if parent_node is None:
            raise KeyError(f'找不到目标父节点 "{parent_id}"')

        # 取 source 的子控件 (如果 source 只有一个根, 取其 children)
        source_children = source.get('ui', {}).get('children', [])
        if not source_children:
            # 可能 source 本身就是一组子节点
            source_children = [source.get('ui', {})]

        parent_node.setdefault('children', []).extend(
            copy.deepcopy(source_children)
        )

        if output_path:
            output_path = Path(output_path)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(target, f, ensure_ascii=False, indent=2)
            logger.info('插入完成: {} → {}[{}] 写入 {}',
                        Path(source_path).name, Path(target_path).name,
                        parent_id, output_path)

        return target

    # ─── 工具 ───

    @staticmethod
    def _load_file(path: str | Path) -> dict:
        path = Path(path)
        if not path.exists():
            raise FileNotFoundError(f'布局文件不存在: {path}')
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)

    @staticmethod
    def diff(base: dict, overlay: dict) -> dict:
        """比较两个布局, 返回 overlay 中有差异的部分"""
        diff_result = {}

        # 比较 UI 树
        diff_result['ui'] = LayoutMerger._diff_nodes(
            base.get('ui', {}), overlay.get('ui', {})
        )

        # 比较 bindings
        base_bind = base.get('bindings', {})
        over_bind = overlay.get('bindings', {})
        bind_diff = {}
        for key in set(list(base_bind.keys()) + list(over_bind.keys())):
            if base_bind.get(key) != over_bind.get(key):
                bind_diff[key] = over_bind.get(key)
        diff_result['bindings'] = bind_diff

        # 比较 variables
        base_vars = base.get('variables', {})
        over_vars = overlay.get('variables', {})
        var_diff = {}
        for key in set(list(base_vars.keys()) + list(over_vars.keys())):
            if base_vars.get(key) != over_vars.get(key):
                var_diff[key] = over_vars.get(key)
        diff_result['variables'] = var_diff

        return diff_result

    @staticmethod
    def _diff_nodes(base_node: dict, overlay_node: dict) -> dict:
        """递归比较节点差异"""
        result = {}
        for key in set(list(base_node.keys()) + list(overlay_node.keys())):
            if key == 'children':
                continue
            if base_node.get(key) != overlay_node.get(key):
                result[key] = copy.deepcopy(overlay_node.get(key))
        return result

    def __repr__(self):
        return '<LayoutMerger>'
