# Recycle Protocol — Diseño del Protocolo
> Documento de trabajo técnico | Marzo 2026

---

## Resumen ejecutivo

Recycle Protocol es la primera refinería on-chain de Web3. Permite a usuarios destruir tokens sin valor (memecoins, scams, polvo) a cambio de $RCY y un Certificado Fiscal NFT. La liquidez extraída de esos tokens alimenta un motor deflacionario que compra y quema $RCY del mercado abierto, creando un ciclo donde el uso de la plataforma genera escasez real del token.

---

## 1. Flujo del usuario

```
Usuario aprueba tokens → llama burn(token, amount) + paga fee en BNB
        │
        ├─ Fee en BNB → Treasury
        ├─ Tokens → Vault (custodia por token)
        ├─ Usuario recibe $RCY proporcional al valor quemado (distribuido desde Bóveda de Recompensas)
        └─ Usuario recibe NFT Certificado Fiscal (prueba on-chain de la quema)
```

---

## 2. Tokenomics

### 2.1 Supply total

**1,000,000,000 $RCY** — supply fijo, pre-minteado al deploy. No hay emisión posterior.

### 2.2 Distribución inicial

| Destino | % | Cantidad |
|---|---|---|
| Bóveda de Recompensas (Incinerator) | 34% | 340,000,000 |
| Preventa PinkSale | 20% | 200,000,000 |
| Liquidez DEX (PancakeSwap) | 11% | 110,000,000 |
| Equipo (bloqueado por hitos) | 15% | 150,000,000 |
| Marketing & Partnerships | 12% | 120,000,000 |
| Reserva del protocolo | 8% | 80,000,000 |
| **Total** | **100%** | **1,000,000,000** |

**Principios del fair launch:**
- 0% de tokens del equipo desbloqueados al inicio
- Liquidez DEX bloqueada automáticamente por PinkSale al lanzamiento
- Sin ventas privadas ocultas
- Precio de preventa fijo, accesible y equitativo

### 2.3 Mecanismo de recompensa

El Incinerator **distribuye** $RCY desde la Bóveda de Recompensas (340M). No se mintean tokens nuevos.

La recompensa es proporcional al valor USD del token quemado, con curva desacelerada (raíz cuadrada) para proteger contra farming agresivo:

```
RCY = minReward + k × √(usdValue)
```

| Valor quemado | RCY recibido (ejemplo: minReward=10, k=100) |
|---|---|
| Sin precio (token sin mercado) | 10 RCY |
| $1 | 110 RCY |
| $100 | 1,010 RCY |
| $10,000 | 10,010 RCY |

> `minReward` y `k` son parámetros configurables por el Multisig. Quemar 10,000× más valor produce solo 100× más RCY — las ballenas no obtienen ventaja desproporcionada.

---

## 3. Motor deflacionario — Buyback & Burn

El valor de $RCY no depende del hype sino del flujo de caja real del protocolo.

### 3.1 Fee del protocolo

Se cobra un **10% sobre la liquidez rescatada** en BNB al vender los tokens del Vault.

### 3.2 Distribución de fees

| Destino | % |
|---|---|
| Buyback & Burn $RCY | 50% |
| Recompensas holders | 25% |
| Desarrollo & Equipo | 15% |
| Marketing & Crecimiento | 10% |

### 3.3 Ciclo deflacionario

```
Usuarios usan la plataforma
        ↓
Vault acumula tokens
        ↓
PoolManager vende tokens → obtiene BNB
        ↓
50% del BNB → compra $RCY en PancakeSwap
        ↓
$RCY comprado → se quema (supply baja)
        ↓
A más uso → más escaso es $RCY
```

> A más basura limpia el protocolo, más ingresos genera. Cuanta más demanda, menos supply. El uso del protocolo es el motor deflacionario.

---

## 4. Certificado Fiscal NFT

Al quemar tokens via el Incinerator, el usuario recibe un NFT que sirve como prueba on-chain de la disposición del activo.

**¿Para qué sirve?**
- Prueba irrefutable (con fecha, hora y firma digital en blockchain) de que el usuario se deshizo del activo
- El valor de salida registrado es cero
- El usuario puede presentar este NFT a su contador como evidencia técnica para declarar pérdida fiscal

**Lo que no es:** no es un documento firmado por ningún organismo fiscal. Es la evidencia técnica que el contador usa para gestionar la declaración ante el fisco.

---

## 5. Contratos del sistema

### 5.1 RCYToken.sol ✅ (requiere ajustes)

Token ERC-20 con supply fijo de 1,000,000,000. Al deploy, todo el supply va a la billetera del equipo para su distribución manual según la tabla de tokenomics.

- El `MINTER_ROLE` debe ser revocado después de la distribución inicial — no se emiten tokens nuevos
- `DEFAULT_ADMIN_ROLE` debe transferirse al Timelock antes del lanzamiento público

### 5.2 Incinerator.sol ✅ (requiere ajustes)

Contrato principal de interacción con el usuario. Recibe tokens basura y distribuye $RCY desde la Bóveda de Recompensas.

**Estado actual:**
- Mintea $RCY nuevo (incorrecto — debe distribuir desde bóveda)
- Envía tokens al dead address (incorrecto — debe enviar al Vault)
- Usa tasa fija por token (incorrecto — debe usar curva sqrt + PriceOracle)
- Protección anti-honeypot via `try/catch` ✅

**Ajustes necesarios:**
- Cambiar destino de tokens de `DEAD` → `Vault`
- Cambiar mint de $RCY → transferencia desde bóveda de recompensas
- Integrar `PriceOracle` para calcular valor USD
- Implementar curva `minReward + k × √(usdValue)` con parámetros configurables
- Mintear NFT Certificado Fiscal al usuario en cada quema exitosa

### 5.3 Vault.sol ❌ (pendiente)

Custodia los tokens recibidos del Incinerator, organizados por token.

- Un vault lógico por token ERC-20 (`mapping(address => uint256)`)
- Solo el `Incinerator` puede depositar
- Solo el `PoolManager` puede retirar
- Función `getBalance(token)` pública

### 5.4 PriceOracle.sol ❌ (pendiente)

Calcula el valor en USD de cualquier token ERC-20 al momento de la quema.

```
¿Tiene par en PancakeSwap V3?
        ├─ Sí → TWAP 30 min sobre par token/BNB × precio BNB/USD (Chainlink)
        └─ No → ¿Tiene par en PancakeSwap V2?
                    ├─ Sí → TWAP sobre V2
                    └─ No → retorna 0 (se aplica minReward)
```

TWAP de 30 minutos protege contra manipulación: sostener un precio manipulado 30 minutos en un token de baja liquidez es prohibitivamente costoso.

### 5.5 PoolManager.sol ❌ (pendiente)

Ejecuta la venta de los tokens acumulados en el Vault.

```
¿El token tiene precio en PancakeSwap?
        ├─ Sí → vender via PancakeSwap → obtener BNB
        └─ No → quemar al dead address (sin valor extraíble)
```

**Distribución del BNB obtenido** (porcentajes configurables):
- 50% → BuybackBurner (compra y quema $RCY)
- 25% → Recompensas holders
- 15% → Treasury (desarrollo & equipo)
- 10% → Treasury (marketing)

**Ejecución en v1:** manual, solo el Multisig puede ejecutar `sellVault(token, minAmountOut)`

### 5.6 BuybackBurner.sol ❌ (pendiente)

Recibe BNB del PoolManager, compra $RCY en PancakeSwap y lo quema al dead address.

### 5.7 TaxLossCertificate.sol ❌ (pendiente)

NFT ERC-721 emitido por el Incinerator en cada quema exitosa. Registra: dirección del usuario, token quemado, cantidad, valor USD al momento de la quema, timestamp y hash de la transacción.

### 5.8 MilestoneVesting.sol ❌ (pendiente)

Contrato de vesting por hitos para los 150,000,000 $RCY del equipo.

- Desbloqueo en 4 hitos (25% cada uno)
- El Multisig ejecuta `unlockNextMilestone()` cuando se alcanza un hito público verificable
- Sin fechas fijas — los hitos están atados a métricas reales (volumen procesado, usuarios activos, liquidez rescatada)
- 0% desbloqueado al inicio

---

## 6. Seguridad y gobernanza

### 6.1 Timelock + Multisig

```
DEFAULT_ADMIN_ROLE → TimelockController (72h) → Gnosis Safe (3 de 5 firmas)
```

**Garantías:**
- Ningún cambio de roles es instantáneo — 72 horas de aviso público
- Ningún miembro del equipo puede actuar solo — requiere 3 de 5 firmas
- Cualquier persona puede monitorear transacciones pendientes en el Timelock

**Implementación:** OpenZeppelin `TimelockController` + Gnosis Safe en BSC.

### 6.2 Roles por contrato

| Contrato | Quién puede interactuar |
|---|---|
| Vault (depósito) | Solo Incinerator |
| Vault (retiro) | Solo PoolManager |
| Incinerator (parámetros) | Solo Multisig via Timelock |
| PoolManager (ejecutar venta) | Solo Multisig |
| MilestoneVesting (desbloqueo) | Solo Multisig |
| RCYToken (admin) | Solo Timelock |

---

## 7. Red de deploy

**BSC (BNB Smart Chain)**
- Fees bajas → accesible para tokens de poco valor
- Mayor concentración de memecoins/shitcoins objetivo
- PancakeSwap V2 + V3 como DEX principal
- Chainlink disponible para precio BNB/USD
- Lanzamiento via PinkSale Fair Launch → listing inmediato en PancakeSwap

---

## 8. Roadmap de desarrollo

### Fase 1 — Contratos core
- [ ] Ajustar `RCYToken`: remover MINTER_ROLE después del deploy inicial
- [ ] Ajustar `Incinerator`: destino Vault + distribución desde bóveda + curva sqrt + oracle
- [ ] Implementar `Vault`
- [ ] Implementar `PriceOracle` (TWAP PancakeSwap + Chainlink)
- [ ] Implementar `TaxLossCertificate` (NFT ERC-721)
- [ ] Tests unitarios y de integración

### Fase 2 — Motor deflacionario
- [ ] Implementar `PoolManager`
- [ ] Implementar `BuybackBurner`
- [ ] Integración con PancakeSwap V2/V3

### Fase 3 — Gobernanza y equipo
- [ ] Implementar `MilestoneVesting`
- [ ] Deploy de Timelock (72h) + Gnosis Safe (3 de 5)
- [ ] Transferir `DEFAULT_ADMIN_ROLE` al Timelock
- [ ] Revocar `MINTER_ROLE` del RCYToken

### Fase 4 — Auditoría y testnet
- [ ] Auditoría externa
- [ ] Deploy completo en BSC Testnet
- [ ] Campaña Zealy para early adopters

### Fase 5 — Lanzamiento
- [ ] Preventa Fair Launch en PinkSale
- [ ] Deploy en BSC Mainnet
- [ ] Listing en PancakeSwap con liquidez bloqueada
- [ ] Verificación de contratos en BscScan
- [ ] Primera quema masiva inaugural

---

## 9. Preguntas pendientes

1. **Valores exactos de `minReward` y `k`** — requiere proyección de volumen objetivo
2. **Hitos concretos del MilestoneVesting** — ¿qué métricas desbloquean cada tramo del equipo?
3. **Porcentajes de fee configurables** — ¿son fijos en el contrato o ajustables por Multisig?
