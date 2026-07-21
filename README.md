# MunchPlan

## Co to je

MunchPlan je týdenní plánovač jídel pro dvoučlennou domácnost. Aplikace umí:

- plánovat **čtyři jídla denně** (snídaně, oběd, večeře, svačiny) — všechny čtyři sloty jsou vidět u každého dne; nechtěné prostě zůstanou prázdné; ✕ u řádku slot vyčistí; automatické doplnění cílí sloty podle vzoru stejného dne minulý týden,
- **automaticky doplnit návrhy** ("Doplnit návrhy") — vážený náhodný výběr z receptů podle slev, rotace, dietních pravidel a vhodnosti receptu pro daný slot; "Přegenerovat" vymění jen automaticky doplněná jídla, ruční výběry zůstávají,
- otevřít **detail jídla** (klepnutím na slot) — přidat víc jídel do jednoho slotu (návštěva), odebrat je, vybrat z návrhů nebo ze všech receptů,
- vést kolekci receptů a inbox "vyzkoušet" pro nápady, které ještě nebyly uvařené; každý recept má "vhodné pro" (kterým jídlům odpovídá),
- **skládat jídla z komponent** — recept může být typ hlavní/příloha/salát; hlavní jídlo si deklaruje své přílohy a saláty; návrhy a automatické doplnění pokládají kompletní jídlo (hlavní + příloha, příloha preferuje slevy); salát se přidává jedním klepnutím na detailu jídla; výběr ze všech receptů vkládá recept samostatně,
- sestavit nákupní seznam ze všech naplánovaných jídel týdne, včetně odečtení toho, co už je doma (spíž),
- vést ruční seznam aktuálních slev.

Postavena na React + TypeScript + Vite, data se ukládají do soukromého GitHub repozitáře.

Aktualizace na skládaná jídla je bezpečná — starší verze aplikace složená jídla jen zobrazí jako spojené názvy (žádná migrace dat, žádný požadavek na souběžnou aktualizaci obou zařízení).

## Nastavení (jednorázově)

1. Vytvořte **soukromý** datový repozitář (např. `munchplan-data`) — stačí prázdný repozitář.
2. Vytvořte fine-grained Personal Access Token: **Settings → Developer settings → Fine-grained tokens**.
   - **Repository access:** pouze datový repozitář (jen ten jeden).
   - **Permissions:** Contents → Read and write.
   - Zvolte doporučenou dobu platnosti (expiraci).
   - **Pozor:** po vypršení tokenu je potřeba vytvořit nový a nastavit ho znovu v aplikaci — aplikace v tom případě zobrazí chybu "Token vypršel...".
3. V aplikaci (záložka **Nastavení**) vyplňte owner, repo a token — na **každém zařízení** zvlášť. Oba partneři musí ukazovat na stejný datový repozitář.

## Aktualizace na verzi s plánováním po dnech (jednorázová migrace dat)

Verze s plánováním po dnech ruší týdenní zapínání/vypínání slotů — nově se u každého dne vždy zobrazují všechny čtyři sloty, nechtěné zůstanou prázdné. Uložené pole `activeSlots` z předchozí verze se při načtení tiše zahodí, žádná data se neztratí.

**Důležité: aktualizujte obě zařízení (oba telefony) přibližně ve stejnou dobu** — stačí načíst novou verzi webu (obnovit stránku). Zařízení se **starou** verzí aplikace totiž stále skrývá sloty mimo svůj uložený výběr `activeSlots` a odškrtnutí slotu jeho jídla smaže. Kdyby se něco pokazilo, data lze obnovit z historie commitů datového repozitáře na GitHubu.

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
