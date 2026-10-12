import {imageUrl} from './config.js';

export function groupItem(group){
  return {...structuredClone(group),kind:'group',selectionId:`group:${group.id}`,
    image:imageUrl(group.image),gallery:group.gallery.map(p=>({...p,image:imageUrl(p.image)})),
    display:{price:'none'},reason:'',prices:{},price:null,details:[],energy:null,technical:''};
}

export function groupTemplate(groups){
  return {id:'grupy-asortymentowe',title:'Grupy · pełna oferta',short:'Główne grupy bez cen',group:'assortment',
    purpose:'Pokaż główne grupy asortymentu lub wybierz te, o których rozmawialiście. Zdjęcia prowadzą do katalogu.',
    tags:['Grupy asortymentowe','Bez cen','Bez stopki'],subject:'Prescot — oferta głównych grup asortymentowych',
    intro:[],closing:[],links:[],items:groups.map(groupItem)};
}

export function groupCopy(items,allGroupIds=[]){
  const groups=items.filter(item=>item.kind==='group'),products=items.filter(item=>item.kind!=='group');
  const all=allGroupIds.length>0&&allGroupIds.every(id=>groups.some(group=>group.id===id));
  const names=groups.map(group=>group.name);
  return {
    subject:products.length?'Prescot — wybrane grupy i propozycje produktów':all?'Prescot — oferta głównych grup asortymentowych':`Prescot — oferta: ${names.length<=2?names.join(' i '):'wybrane grupy asortymentowe'}`,
    intro:[`dziękuję za rozmowę. ${all?'Przesyłam przegląd głównych grup asortymentu Prescot.':'Przesyłam ofertę wybranych grup asortymentowych: '+names.join(', ')+'.'} Pod linkami znajdą Państwo dostępne modele i ich parametry.${products.length?' Poniżej są również wybrane propozycje produktów.':''}`],
    closing:['Które grupy lub modele odpowiadają Państwa potrzebom? Proszę wskazać zastosowanie i orientacyjne ilości — pomożemy dobrać odpowiednie produkty.'],
  };
}
