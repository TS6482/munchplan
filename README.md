# MunchPlan

## Co to je

MunchPlan je týdenní plánovač večeří pro dvoučlennou domácnost. Aplikace umí:

- vést kolekci receptů a inbox "vyzkoušet" pro nápady, které ještě nebyly uvařené,
- navrhovat recepty na daný den podle aktuálních slev, rotace (aby se jídla neopakovala moc často) a nastavených dietních pravidel,
- sestavit nákupní seznam z naplánovaného týdne, včetně odečtení toho, co už je doma (spíž),
- vést ruční seznam aktuálních slev.

Postavena na React + TypeScript + Vite, data se ukládají do soukromého GitHub repozitáře.

## Nastavení (jednorázově)

1. Vytvořte **soukromý** datový repozitář (např. `munchplan-data`) — stačí prázdný repozitář.
2. Vytvořte fine-grained Personal Access Token: **Settings → Developer settings → Fine-grained tokens**.
   - **Repository access:** pouze datový repozitář (jen ten jeden).
   - **Permissions:** Contents → Read and write.
   - Zvolte doporučenou dobu platnosti (expiraci).
   - **Pozor:** po vypršení tokenu je potřeba vytvořit nový a nastavit ho znovu v aplikaci — aplikace v tom případě zobrazí chybu "Token vypršel...".
3. V aplikaci (záložka **Nastavení**) vyplňte owner, repo a token — na **každém zařízení** zvlášť. Oba partneři musí ukazovat na stejný datový repozitář.

## Bezpečnostní poznámka

Token je uložen v `localStorage` prohlížeče. Všechny weby na `{username}.github.io` sdílejí jeden origin, takže token by v principu mohl číst i jiná aplikace hostovaná na stejné doméně. Proto token vždy omezujte jen na datový repozitář (fine-grained token, ne classic token s plným přístupem).

## Offline

Aplikace ukládá poslední načtená data do mezipaměti. Díky tomu je nákupní seznam čitelný i bez signálu (např. v obchodě). Zápisy provedené offline viditelně selžou.

## Nasazení (deploy)

Jednorázově: v repozitáři **Settings → Pages → Source: "GitHub Actions"**.

Poté každý push do `main` automaticky nasadí web na:

<https://ts6482.github.io/munchplan/>

Hodnota `base` v `vite.config.ts` musí odpovídat názvu repozitáře.

## Vývoj

```bash
npm install
npm run dev
npm test
npm run lint
npm run build
```
