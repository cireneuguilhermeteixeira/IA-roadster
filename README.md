# Roadster // Vector Lab

Protótipo 3D de um roadster **estilizado e inspirado no Tesla Roadster**, feito em Three.js e Vite. Inclui **quatro propulsores vetoriais** junto às rodas, uma rampa curva larga e fixa de 180 graus, saída invertida, controle manual de atitude, diferencial de potência, gimbals, estabilização assistida e física arcade.

## Iniciar

Requer Node.js 20.19+ ou 22.12+.

```bash
npm install
npm run dev
```

Abra a URL mostrada pelo Vite (geralmente `http://localhost:5173`). Para build de produção:

```bash
npm run build
npm run preview
```

## Passo a passo

1. Clique **ACELERAR NA RAMPA**. O carro percorre o trecho reto e sobe pela curva da pista, que permanece fixa.
2. O carro sai invertido no trecho superior, a cerca de 44 metros do solo.
3. Tente recuperar com os controles manuais ou pressione `T` para ligar a estabilização. Ligada, ela endireita o carro, controla a descida e busca a marca no chão diretamente abaixo da saída da rampa.
4. Ajuste a potência com o slider ou mantenha `Shift` pressionado para potência máxima.
5. Use `R` para repetir.

## Controles

| Comando     | Ação                                  |
| ----------- | ------------------------------------- |
| W / S       | Comando diferencial de pitch (nariz)  |
| A / D       | Comando diferencial de roll (rolagem) |
| Q / E       | Comando de yaw pelos gimbals          |
| Setas ↑ / ↓ | Desviar vetores para frente/trás      |
| Setas ← / → | Desviar vetores lateralmente          |
| Shift       | Potência máxima enquanto pressionado  |
| T           | Alternar autoestabilização            |
| R           | Reiniciar                             |
| Mouse       | Orbitar e aproximar a câmera          |

> **Importante:** o modelo 3D é criado proceduralmente, sem necessidade de baixar arquivos GLB. Não é uma réplica oficial licenciada. A simulação é propositalmente simplificada: inércias, saturação dos propulsores, gimbals e gravidade são aproximados. O sistema não modela dinâmica de fluidos, suspensão, contatos de rodas nem controle espacial real. A luz solar incide verticalmente e o modo automático busca a marca diretamente abaixo da saída da rampa. Os propulsores são fictícios.

## Código

- `src/visuals.js`: cena, geometria da rampa e modelo do carro.
- `src/main.js`: estado, comandos, estabilização e integração da física.
- `src/style.css`: HUD e interface.
- `index.html`: interface e entrada do Vite.

## Como o controle funciona

Na rampa, `trackAt` fornece a posição e a inclinação do carro ao longo de um trecho reto, um semicírculo vertical e a saída superior. Durante esse percurso, a orientação acompanha a pista. Na saída, o carro começa a cair sem velocidade horizontal inicial.

Em voo, a simulação avança em passos fixos de `1/120 s`. Cada um dos quatro propulsores aplica uma aceleração no eixo vertical local do carro. Diferenças de potência entre os lados geram torque de rolagem e arfagem; a inclinação dos bicos e o empuxo geram movimentos laterais e guinada. Gravidade, velocidade e orientação são integradas a cada passo.

Com a estabilização ligada, um controlador compara a orientação atual (quaternion) com a orientação horizontal. O erro angular determina o torque corretivo, e a velocidade angular entra como amortecimento para evitar oscilações. Um segundo controle ajusta o empuxo para desacelerar a descida perto do chão. A correção horizontal busca a marca sob a saída da rampa. Há torque e aceleração corretiva adicionais para tornar a recuperação viável; este é um modelo arcade, não uma simulação física rigorosa.

Execute `yarn lint` para verificar o JavaScript com ESLint e a formatação com Prettier. Use `yarn format` para aplicar a formatação.
