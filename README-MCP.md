# Servidor MCP — Conectar o projeto ao Gemini

Este diretório contém um **servidor MCP** (`mcp_server.py`) que expõe a documentação,
os scripts e os dados do projeto de Segmentação Homogênea de Pavimentos para o Gemini,
usando o recurso **"Connected Apps" personalizados** do Gemini (URL terminando em `/mcp`).

---

## O que ele expõe

| Tipo | Nome | Descrição |
|---|---|---|
| Tool | `list_documents` | lista todos os arquivos disponíveis |
| Tool | `read_file` | lê o conteúdo de um arquivo (ex.: `documentacao-ia/01-objetivo.md`) |
| Tool | `read_documentation` | lê e concatena todos os `.md` de documentação |
| Tool | `search_docs` | busca um texto em todos os arquivos |
| Resource | `docs://overview` | visão geral (README/AGENTS.md) |

---

## 1. Rodar localmente (teste)

```powershell
conda activate SGP
cd segmentacao-linear
python mcp_server.py
```

O servidor sobe em Streamable HTTP em:

```
http://localhost:8000/mcp
```

**Testar rapidamente** (em outra janela):

```powershell
# listar arquivos via ferramenta MCP (a resposta aparece no log do servidor)
python -c "import httpx; print(httpx.post('http://localhost:8000/mcp', json={'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'test','version':'0'}}}, headers={'Accept':'application/json, text/event-stream','Content-Type':'application/json'}).text)"
```

---

## 2. O requisito do Gemini: URL HTTPS pública

O Gemini **só aceita URLs que comecem com `https://`**. O servidor local acima é
`http://localhost`, então é preciso expô-lo publicamente. Duas opções:

### Opção A — Túnel (rápido, para teste)

Usa `cloudflared` (Cloudflare) para criar um túnel HTTPS temporário:

```powershell
# 1) baixar cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
# 2) iniciar o túnel apontando para o servidor local
cloudflared tunnel --url http://localhost:8000
```

O Cloudflare imprime uma URL como `https://xxxx.trycloudflare.com`.
**No Gemini, use:** `https://xxxx.trycloudflare.com/mcp`

> O túnel trycloudflare muda de URL a cada reinício. Bom para testar; ruim para uso contínuo.

### Opção B — Deploy em nuvem (URL estável)

Implante `mcp_server.py` em um serviço que rode Python e sirva HTTPS:

| Serviço | Observações |
|---|---|
| **Render / Railway / Fly.io** | crie um "Web Service", comando `python mcp_server.py`, e use a URL gerada (`https://<app>.onrender.com`). |
| **Google Cloud Run** | containerize e sirva na porta `$PORT`; o servidor já lê `PORT` do ambiente. |

Configurações úteis via variável de ambiente:

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `8000` | porta HTTP (obrigatório em Cloud Run/Railway) |
| `MCP_HOST` | `0.0.0.0` | host de escuta |
| `SGP_DOCS_DIR` | pasta do script | diretório-base a ser exposto |

**No Gemini, use:** `https://<seu-app>/mcp`

---

## 3. Conectar no Gemini

1. No Gemini, vá em **Configurações → Apps → Conectar um app personalizado** (ou equivalente).
2. Cole a URL `https://.../mcp`.
3. Confirme a conexão.

A partir daí, o Gemini passa a poder chamar as ferramentas (`list_documents`,
`read_file`, `read_documentation`, `search_docs`) para explorar o projeto.

---

## 4. Segurança

- O servidor **restringe** o acesso ao diretório-base (`SGP_DOCS_DIR`), impedindo leitura
  de arquivos fora dele (proteção contra *path traversal*).
- Exclui automaticamente pastas sensíveis (`.git`, `.venv`, `__pycache__`, etc.).
- **Atenção:** não exponha dados confidenciais. O Gemini alerta que o app conectado
  não é verificado pelo Google — use apenas com serviços/arquivos confiáveis.
