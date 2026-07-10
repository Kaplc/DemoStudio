"""
Project Manager — discover & manage projects from the projects/ folder
======================================================================
Each project folder must contain a project.json configuration file.

Format:
    {
        "name": "Snake",
        "description": "Classic 2.5D snake game with MCP control",
        "version": "1.0.0",
        "main": "snake_game.py",
        "mcp_server": "snake_mcp_server.py",
        "tags": ["game", "snake", "mcp"]
    }
"""
import json
from pathlib import Path

from core.logger import get_logger
logger = get_logger('project')


# ── 项目根目录 (projects/) ──
PROJECTS_DIR = Path(__file__).resolve().parent.parent / 'projects'


class Project:
    """单个工程的信息"""

    def __init__(self, folder: Path, config: dict):
        self.folder = folder                    # 工程文件夹路径
        self.name = config.get('name', folder.name)
        self.description = config.get('description', '')
        self.version = config.get('version', '0.1.0')
        self.main = config.get('main', '')      # 主入口文件
        self.mcp_server = config.get('mcp_server', '')  # MCP 服务文件
        self.tags = config.get('tags', [])
        self._raw = config

    @property
    def main_path(self) -> Path | None:
        """主入口文件的完整路径"""
        if self.main:
            p = self.folder / self.main
            return p if p.exists() else None
        return None

    @property
    def mcp_path(self) -> Path | None:
        """MCP 服务文件的完整路径"""
        if self.mcp_server:
            p = self.folder / self.mcp_server
            return p if p.exists() else None
        return None

    def __repr__(self):
        return f'<Project "{self.name}" @ {self.folder.name}>'


def discover_projects() -> list[Project]:
    """扫描 projects/ 文件夹，返回所有有效工程列表"""
    projects = []
    if not PROJECTS_DIR.exists():
        logger.warning("Projects directory not found: {}", PROJECTS_DIR)
        return projects

    for child in sorted(PROJECTS_DIR.iterdir()):
        if not child.is_dir():
            continue
        # 跳过 __pycache__ 等隐藏目录
        if child.name.startswith('_') or child.name.startswith('.'):
            continue

        config_file = child / 'project.json'
        if not config_file.exists():
            logger.debug("Skipping '{}': no project.json", child.name)
            continue

        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                config = json.load(f)
            project = Project(child, config)
            projects.append(project)
            logger.info("Discovered project: {} v{}", project.name, project.version)
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("Failed to load {}: {}", config_file, e)

    return projects


def create_project_config(folder_name: str, *, name: str = None,
                          description: str = '', main: str = '',
                          mcp_server: str = '', tags: list = None) -> Path:
    """为现有文件夹创建 project.json 配置"""
    folder = PROJECTS_DIR / folder_name
    if not folder.exists():
        raise FileNotFoundError(f"Folder not found: {folder}")

    config = {
        "name": name or folder_name,
        "description": description,
        "version": "1.0.0",
        "main": main,
        "mcp_server": mcp_server,
        "tags": tags or [],
    }

    config_file = folder / 'project.json'
    with open(config_file, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

    logger.info("Created project config: {}", config_file)
    return config_file
