"""
Servidor MCP (Model Context Protocol) do projeto de Segmentação Homogênea de
Pavimentos (SGP / Dynatest).

Expõe a documentação, os scripts e os dados do diretório `segmentacao-linear/`
para o Gemini (via "Connected Apps" personalizados, URL terminando em `/mcp`).

Uso:
    python mcp_server.py

O servidor sobe em Streamable HTTP. Por padrão o endpoint é:
    http://0.0.0.0:8000/mcp

Para o Gemini aceitar, a URL precisa ser pública e HTTPS (ver README-MCP.md).
"""

import os
from pathlib import Path

from mcp.server.fastmcp import FastMCP

# Diretório-base exposto: por padrão, a própria pasta deste arquivo.
BASE_DIR = Path(
    os.environ.get("SGP_DOCS_DIR", os.path.dirname(os.path.abspath(__file__)))
).resolve()

HOST = os.environ.get("MCP_HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", os.environ.get("MCP_PORT", "8000")))

EXTENSOES_PERMITIDAS = {".md", ".txt", ".py", ".json", ".csv", ".ipynb", ".xml", ".sql"}
PASTAS_IGNORADAS = {".git", ".venv", "__pycache__", "node_modules", ".ipynb_checkpoints", "dist", "build"}

mcp = FastMCP(
    name="sgp-segmentacao",
    instructions=(
        "Servidor MCP do projeto de Segmentação Homogênea de Pavimentos (SGP/Dynatest). "
        "Fornece acesso à documentação, scripts e dados do diretório segmentacao-linear. "
        "Use as ferramentas list_documents, read_file, read_documentation e search_docs "
        "para explorar o projeto."
    ),
    host=HOST,
    port=PORT,
)


def _caminho_seguro(rel: str) -> Path:
    """Resolve um caminho relativo e impede acesso fora do diretório-base."""
    p = (BASE_DIR / rel).resolve()
    if not str(p).startswith(str(BASE_DIR)):
        raise ValueError(f"caminho fora do diretório-base: {rel}")
    return p


def _arquivos() -> list[str]:
    """Lista caminhos absolutos dos arquivos expostos (filtrando extensões e pastas)."""
    saida: list[str] = []
    for raiz, dirs, arquivos in os.walk(BASE_DIR):
        dirs[:] = [d for d in dirs if d not in PASTAS_IGNORADAS]
        for nome in arquivos:
            if Path(nome).suffix.lower() in EXTENSOES_PERMITIDAS:
                saida.append(str(Path(raiz) / nome))
    return saida


def _rel(abs_path: str) -> str:
    return os.path.relpath(abs_path, BASE_DIR).replace("\\", "/")


@mcp.tool()
def list_documents() -> str:
    """Lista todos os arquivos disponíveis (documentação, scripts, dados), um por linha."""
    arquivos = sorted(_arquivos())
    if not arquivos:
        return "(nenhum arquivo encontrado)"
    return "\n".join(_rel(a) for a in arquivos)


@mcp.tool()
def read_file(path: str) -> str:
    """Lê o conteúdo de um arquivo do diretório.

    Args:
        path: caminho relativo ao diretório-base (ex.: 'documentacao-ia/01-objetivo.md').
    """
    try:
        p = _caminho_seguro(path)
    except ValueError as e:
        return f"[erro] {e}"
    if not p.is_file():
        return f"[erro] arquivo não encontrado: {path}"
    try:
        return p.read_text(encoding="utf-8", errors="replace")
    except Exception as e:  # noqa: BLE001
        return f"[erro] ao ler arquivo: {e}"


@mcp.tool()
def read_documentation() -> str:
    """Lê e concatena todos os arquivos .md de documentação (visão geral completa do projeto)."""
    docs = sorted(a for a in _arquivos() if a.lower().endswith(".md"))
    if not docs:
        return "(nenhum .md encontrado)"
    blocos = []
    for d in docs:
        try:
            conteudo = Path(d).read_text(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            continue
        blocos.append(f"===== {_rel(d)} =====\n{conteudo}")
    return "\n\n".join(blocos)


@mcp.tool()
def search_docs(query: str) -> str:
    """Busca (sem diferenciar maiúsculas/minúsculas) por um texto em todos os arquivos.

    Args:
        query: texto a procurar.
    """
    if not query:
        return "[erro] informe um texto para buscar."
    q = query.lower()
    resultados: list[str] = []
    for a in _arquivos():
        try:
            texto = Path(a).read_text(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            continue
        if q not in texto.lower():
            continue
        rel = _rel(a)
        for i, linha in enumerate(texto.splitlines(), 1):
            if q in linha.lower():
                resultados.append(f"{rel}:{i}: {linha.strip()}")
                if len(resultados) >= 200:
                    break
        if len(resultados) >= 200:
            break
    if not resultados:
        return f"Nenhuma ocorrência de '{query}'."
    return "\n".join(resultados)


@mcp.resource("docs://overview")
def overview() -> str:
    """Visão geral do projeto (README da documentação, se existir)."""
    for candidato in ("documentacao-ia/README.md", "README.md", "AGENTS.md"):
        p = BASE_DIR / candidato
        if p.is_file():
            return p.read_text(encoding="utf-8", errors="replace")
    return list_documents()


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
