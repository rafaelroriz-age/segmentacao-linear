"""Filtro 'clean' do git: remove saidas e contadores dos notebooks antes do commit.

A copia de trabalho continua com as saidas; so o que vai para o repositorio fica limpo.
Configuracao (uma vez por clone):
    git config filter.nbstrip.clean "python tools/nbstrip.py"
    git config filter.nbstrip.smudge cat
"""
import json, sys

nb = json.loads(sys.stdin.buffer.read().decode('utf-8'))
for c in nb.get('cells', []):
    if c.get('cell_type') == 'code':
        c['outputs'] = []
        c['execution_count'] = None
    c.get('metadata', {}).pop('execution', None)
sys.stdout.buffer.write((json.dumps(nb, ensure_ascii=False, indent=1) + '\n').encode('utf-8'))
