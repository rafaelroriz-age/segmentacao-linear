Dataset: 
    1. achar e corrigir analitica_segmentos_200m_16-09-2026.csv
    2. retornar ao analitica_segmentos_200m_16-09-2026.csv, mas corrigido, como dataset oficial

Yago:
    Permitir a escolha dos parâmetros utilizados: concluído
	O usuário seleciona qual parâmetro funcional entre IGG e IRI; concluído
	O usuário seleciona qual parâmetro estrutural, D0, RAIO, DIFERENÇA ACUMULADA; concluído
Manter a ordem lógica da segmentação na apresentação dos resultados: Funcional -> Estrutural concluído
Mostrar em gráficos separados primeiramente a segmentação funcional feita, e no próximo gráfico mostrar a segmentação estrutural. concluído

MODELO:
    O usuário seleciona qual parâmetro estrutural, D0, RAIO, DIFERENÇA ACUMULADA; essa mudança pede para que o hiperparametro 'model' do pelt possa ser alterado, faça isso concluído
    A análise de sensibilidade (e rodar o modelo) deve funcionar como um sandbox, com testes de penalidade modelo e atributo 
 
Gráficos:

    Estão muito poluídos, separá-los ou até mesmo outra ideia para deixar menos poluído
    Diminua as linhas, elas atrapalham a visualização concluído
    Idente linhas (verticais) de cores iguais, mas em gráficos diferentes 
    Crie um 3 gráfico, que une os segmentos funcionais e estruturais, esse gráfico tera o eixo y duplicado (igg e d0)

Organização:
