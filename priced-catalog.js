import {catalogItem,normalize} from './offer.js?v=6';
import {hasPrice,pricedDisplay,identificationLine,itemPresentation} from './product-details.js?v=6';

export function preparePricedCatalog(products,pricing,featured=[]){
  const rank=new Map(featured.map((key,index)=>[key,index]));
  const attach=record=>{
    const identity=pricing.identities?.[record.sku];
    record.tradeIndex=identity?.tradeIndex||'';record.ean=identity?.ean||record.ean||record.specs?.EAN||'';
    record.prices=Object.fromEntries(Object.entries(pricing.bySku?.[record.sku]??{}).map(([key,value])=>[key,{...value,taxBasis:pricing.feeds[key]?.taxBasis||value.taxBasis,currency:pricing.feeds[key]?.currency||value.currency,updatedAt:pricing.feeds[key]?.fetchedAt||pricing.updatedAt}]));
  };
  const result=[];
  for(const source of products){
    const product=structuredClone(source);
    if(product.kind==='family'){
      product.variants=(product.variants??[]).map(variant=>{attach(variant);variant.featuredRank=rank.get(`${product.id}::${variant.sku}`)??Infinity;return variant;}).filter(variant=>hasPrice(catalogItem(product,variant))).sort((a,b)=>a.featuredRank-b.featuredRank);
      if(!product.variants.length)continue;
      product.featuredRank=product.variants[0].featuredRank;
    }else{
      attach(product);if(!hasPrice(product))continue;product.featuredRank=rank.get(product.id)??Infinity;
    }
    product.searchText=normalize([product.name,product.sku,product.tradeIndex,product.ean,product.family,product.categoryLabel,product.summary,...Object.values(product.specs??{}),...(product.variants??[]).flatMap(v=>[v.sku,v.tradeIndex,v.name,v.ean,...Object.values(v.specs??{})])].join(' '));
    result.push(product);
  }
  return result.sort((a,b)=>a.featuredRank-b.featuredRank);
}

export function resolvePresetItem(reference,catalog){
  const product=catalog.find(p=>p.id===(reference.catalogId||reference.id)||!reference.catalogId&&(p.url===reference.url||reference.sku&&p.sku===reference.sku));
  if(!product)return null;
  const variant=reference.variantSku?product.variants?.find(v=>v.sku===reference.variantSku):null;
  if(reference.variantSku&&!variant)return null;
  const item=catalogItem(product,variant);
  if(!hasPrice(item))return null;
  if(reference.name)item.name=reference.name;if(reference.description)item.description=reference.description;
  item.display=pricedDisplay(item,reference.display);item.technical=identificationLine(item);
  return {...item,...itemPresentation(item)};
}
