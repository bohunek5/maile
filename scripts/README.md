# Aktualizacja cenników

Kreator na GitHub Pages używa zaszyfrowanego zestawu danych z datą aktualizacji.
Nie pobiera XML-i na żywo przy otwarciu maila.

1. Uruchom `python3 scripts/sync-prices.py` z katalogu projektu. Importer pobiera
   `prescot.xml` (hurt) i `prescotcloud.xml` (detal) z prescot.wapromag.pl.
   Opcja `--offline` używa ostatnich pobranych plików.
2. W `private/prices-settings.json` są potwierdzone przez właściciela ustawienia
   obu źródeł: `currency: "PLN"`, `taxBasis: "net"`. XML-e nie deklarują tych danych.
3. Zaszyfruj bibliotekę, podając hasło przez standardowe wejście, bez zapisywania
   go w poleceniu ani pliku:

   ```sh
   python3 -c 'import getpass,subprocess; subprocess.run(["node","scripts/encrypt.mjs"],input=getpass.getpass("Hasło: "),text=True,check=True)'
   ```

4. Sprawdź testy i opublikuj zmieniony `library.enc.json` w repozytorium.
   Nie dodawaj `private/` do Gita. Surowe XML-e, dopasowane ceny i ustawienia
   pozostają w tym ignorowanym katalogu.

Dopasowanie wykorzystuje dokładny SKU lub jednoznaczny EAN. Konflikty, zerowe
ceny oraz ceny bez potwierdzonej jednostki nie są dodawane do maila.
Jednostka detaliczna pochodzi z hurtu tylko przy jednoznacznej zgodności SKU i EAN
między źródłami. Kwoty nie są przeliczane między sztuką, opakowaniem i metrem.
Przy cenie sztuki taśmy pokazujemy długość rolki z jednoznacznych danych XML.
Sprzeczne długości opakowania blokują daną cenę. `Kod_produktu` to indeks handlowy;
kod producenta pozostaje wewnętrznym kluczem katalogu. Indeks handlowy oraz EAN
są wyświetlane również wtedy, gdy kwota ceny jest niedostępna.

Parametry i klasa energetyczna pochodzą z katalogu, nie z XML cenowego.
Grafiki `assets/energy/A.png`–`G.png` to niezmienione oryginały z
`prescot/katalog_tasmy_led_2026/assets_eei/` w głównym workspace.
