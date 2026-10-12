// Keep deployment paths relative; product destinations remain on the official catalogue.
export const config = Object.freeze({
  catalogUrl: 'https://www.prescot.pl/katalog/',
  siteBase: new URL('./', import.meta.url).href,
  libraryPath: './library.enc.json',
  catalogPageSize: 36,
});

export function imageUrl(value) {
  if (!value) return '';
  return new URL(value, config.siteBase).href;
}
