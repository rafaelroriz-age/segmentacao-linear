Dataset: 
    achar e corrigir analitica_segmentos_200m_16-09-2026.csv concluido
    retornar ao analitica_segmentos_200m_16-09-2026.csv, mas corrigido, como dataset oficial concluído

Yago:
    Permitir a escolha dos parâmetros utilizados: concluído
	O usuário seleciona qual parâmetro funcional entre IGG e IRI; concluído
	O usuário seleciona qual parâmetro estrutural, D0, RAIO, DIFERENÇA ACUMULADA; concluído
Manter a ordem lógica da segmentação na apresentação dos resultados: Funcional -> Estrutural concluído
Mostrar em gráficos separados primeiramente a segmentação funcional feita, e no próximo gráfico mostrar a segmentação estrutural. concluído

MODELO:
    O usuário seleciona qual parâmetro estrutural, D0, RAIO, DIFERENÇA ACUMULADA; essa mudança pede para que o hiperparametro 'model' do pelt possa ser alterado, faça isso concluído
    A análise de sensibilidade (e rodar o modelo) deve funcionar como um sandbox, com testes de penalidade modelo e atributo concluido revisar
    Rodar o modelo deve dar o opção de usar o que já está sendo utilizado ou utilizar os seus próprios dados, e pode mesclar (por exemplo: shp que já está disponível no site e um novo dataset) concluido revisar
    poder gerar a tabela geral utilizando o iri como parâmetro funcional ao invés do iri, ou seja, para o geral e o sre isolado (o que já é possível) conseguir visualizar o mapa e baixar as tabelas com a segmentação feita usando o iri como etapa funcional

Gráficos:

    Estão muito poluídos, separá-los ou até mesmo outra ideia para deixar menos poluído concluído 
    Diminua as linhas, elas atrapalham a visualização concluído
    Idente linhas (verticais) de cores iguais, mas em gráficos diferentes, e junte elas no terceiro gráfico concluído 
    Crie um 3 gráfico, que une os segmentos funcionais e estruturais, esse gráfico terá o eixo y duplicado (igg e d0) concluído
    Traga apenas as linhas verticais do grafico 1 para o gráfico 2 concluido
    transforme tanto no mapa, quanto nos graficos 4 de resultados, o "combinada" em Funcional + estrutural , na lógica dos gráficos 3 Funcional + estrutural no mesmo gráfico concluido

Regras de negócio
    Nova regra de mínimo e máximo min 1000 m(1k) max 20km (caso o sre tenha menos de 1000m é apenas um segmento)concluido

Organização:

Fazer um novo repo, para "homologação", copiando esse, para os testes de eventuais funções concluido

Documentação:
Descobrir como fazer como os dois artigos nos quais a plataforma se baseia e as atuais tecnologias, maneiras de diminuir a variância, melhorar a explicabilidade e controlar regras de negocio

descobrir como melhorar acurácia do modelo e usabilidade dentro do SGP GOINFRA
