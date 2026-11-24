export type ChoiceOption={value:string;label:string;disabled?:boolean};
export function searchText(value:string){return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ё/g,'е').replace(/♯/g,'#').replace(/♭/g,'b').trim();}
export function filterOptions(options:ChoiceOption[],query:string){const terms=searchText(query).split(/\s+/);return options.filter(o=>terms.every(term=>searchText(o.label).includes(term)));}
export function moveOption(options:ChoiceOption[],index:number,direction:1|-1){for(let i=1;i<=options.length;i++){const next=(index+direction*i+options.length)%options.length;if(!options[next].disabled)return next;}return -1;}
