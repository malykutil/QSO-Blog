# OK2KZB Android aplikace

Nativní Android aplikace zobrazuje celý produkční dashboard `/solar` a zároveň na pozadí hlídá bezpečnostní stavy. Uživatelská přihlašovací obrazovka byla odstraněna; aplikace se po spuštění ověří sama pomocí přístupových údajů vložených pouze při sestavení APK.

## Funkce

- Všechny funkce webu `/solar`, včetně grafů, časových rozsahů, UPS, MQ-9, ovládání relé a potvrzení poplachu.
- Automatické ověření bez zadávání jména a hesla v telefonu.
- Kontrola telemetrie každých 15 sekund v trvalé službě na popředí.
- Hodinové oznámení se souhrnem teplot, solárních proudů, proudu baterie a UPS.
- Hlasitý opakovaný alarm pro aktivní MQ-9 poplach, telemetrii starší než pět minut, baterii pod 11,8 V nebo baterii nad 50 °C.
- Kritický alarm používá alarmový zvukový kanál, nastaví alarmovou hlasitost na maximum a po ztišení obnoví původní hlasitost.
- Automatický start dohledu po restartu telefonu.
- Samostatná poplachová obrazovka dostupná i přes zamčený telefon.

## Povinné nastavení telefonu

Po prvním spuštění otevři ozubené kolo v horní liště a povol:

1. oznámení aplikace,
2. přístup přes režim Nerušit,
3. zobrazení kritického alarmu přes zamčenou obrazovku,
4. neomezený běh na pozadí v nastavení baterie telefonu.

Bez přístupu k režimu Nerušit Android negarantuje zvuk při aktivním DND. Bez povolení oznámení se nezobrazí hodinové souhrny ani poplachová karta.

## Lokální konfigurace sestavení

Soubor `local.properties` se neposílá do GitHubu. Musí obsahovat cestu k Android SDK a přístup aplikace:

```properties
sdk.dir=C:\\Users\\uzivatel\\AppData\\Local\\Android\\Sdk
SOLAR_USERNAME=...
SOLAR_PASSWORD=...
```

Stejné hodnoty lze předat proměnnými prostředí `SOLAR_USERNAME`, `SOLAR_PASSWORD` a volitelně `SOLAR_BASE_URL`.

Přístupové údaje jsou součástí výsledného APK a zkušený uživatel je může z aplikace získat. Aplikaci proto neposílej veřejně; požadavek „kdo má aplikaci, nemusí se přihlašovat“ z ní dělá přístupový klíč k ovládání relé.

## Sestavení APK

Otevři složku `android/` v Android Studiu a spusť úlohu `assembleDebug` nebo v terminálu použij přiložený Gradle Wrapper:

```powershell
.\gradlew.bat assembleDebug
```

Výsledné APK vznikne v `android/app/build/outputs/apk/debug/app-debug.apk`.

## Důležité bezpečnostní omezení

Mobilní aplikace, síťové spojení ani MQ-9 nejsou certifikovaný požární systém. Výpadek telefonu, internetu, Android služby nebo serveru může oznámení zpozdit. V objektu musí zůstat samostatný certifikovaný kouřový/CO hlásič a hardwarová ochrana.
