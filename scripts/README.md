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
są pokazywane przy konkretnej pozycji oferty.

Katalog konkretnych produktów i dobór z rozmowy zawierają produkty i warianty
z potwierdzoną, dodatnią ceną oraz jednostką. Domyślnie pokazujemy hurt;
jeśli dostępny jest tylko detal, pokazujemy detal. Handlowiec może wybrać
„Bez ceny” przy produkcie lub „Bez cen” dla wszystkich wybranych produktów.
Ukrycie jest świadomym wyborem, a nie zastąpieniem brakującej ceny.
Szyfrowanie przerywa się, jeśli pozycja jednego z 10 wzorów produktowych
nie ma potwierdzonej ceny w katalogu.
Polecane produkty z `library.featured` są pierwsze w katalogu; to wybór
asortymentu na start, a nie ranking sprzedaży. Rodziny wymagają wyboru
konkretnego wariantu. Przy imporcie zachowujemy jawny wybór ukrycia ceny;
pozostałe dane produktów są odtwarzane z aktualnego katalogu.

`private/groups.json` zawiera pięć grup asortymentowych. Każda ma oryginalne
zdjęcie główne, cztery podlinkowane przykłady oraz adres kategorii katalogu.
Grupy nie mają cen ani wspólnych indeksów, EAN i parametrów produktów.
Kreator dodaje 11. wzór „Grupy · pełna oferta”; handlowiec może wybrać dowolny
podzbiór, wszystkie grupy albo połączyć je z konkretnymi produktami.
W eksporcie zdjęcia grup układane są tabelami z CSS inline, bez skryptów.

Parametry i klasa energetyczna pochodzą z katalogu, nie z XML cenowego.
Grafiki `assets/energy/A.png`–`G.png` to niezmienione oryginały z
`prescot/katalog_tasmy_led_2026/assets_eei/` w głównym workspace.
