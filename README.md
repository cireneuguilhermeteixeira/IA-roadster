# Roadster // Vector Lab

Protótipo 3D de um roadster **estilizado e inspirado no Tesla Roadster**, feito em Three.js e Vite. Inclui **quatro propulsores vetoriais** junto às rodas, plataforma suspensa que gira **180 graus** em torno do eixo longitudinal, queda livre, controle manual de atitude, diferencial de potência, gimbals, estabilização assistida e física arcade.

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

1. Clique **GIRAR 180° + SOLTAR**. A plataforma gira lentamente por 3,2 segundos, levando o Roadster junto.
2. O carro é liberado invertido a 48 metros do solo.
3. Tente recuperar com os controles manuais ou pressione `T` para alternar o controle automático.
4. Ajuste a potência com o slider ou mantenha `Shift` pressionado para potência máxima.
5. Use `R` para repetir.

## Controles

| Comando | Ação |
|---|---|
| W / S | Comando diferencial de pitch (nariz) |
| A / D | Comando diferencial de roll (rolagem) |
| Q / E | Comando de yaw pelos gimbals |
| Setas ↑ / ↓ | Desviar vetores para frente/trás |
| Setas ← / → | Desviar vetores lateralmente |
| Shift | Potência máxima enquanto pressionado |
| T | Alternar autoestabilização |
| R | Reiniciar |
| Mouse | Orbitar e aproximar a câmera |

> **Importante:** o modelo 3D é criado proceduralmente, sem necessidade de baixar arquivos GLB. Não é uma réplica oficial licenciada. A simulação é propositalmente simplificada: inércias, saturação dos propulsores, gimbals e gravidade são aproximados. O sistema não modela dinâmica de fluidos, suspensão, contatos de rodas nem controle espacial real. O modo automático aponta para orientação horizontal global, não para terrenos inclinados. Os propulsores são fictícios.

## Código

- `src/main.js`: cena, roadster, plataforma, controles e integração de física.
- `src/style.css`: HUD e interface.
- `index.html`: entrada do Vite.
