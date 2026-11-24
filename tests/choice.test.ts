import {describe,expect,it} from 'vitest';
import {filterOptions,moveOption,type ChoiceOption} from '../src/choice';
const options:ChoiceOption[]=[{value:'a',label:'Светлое'},{value:'b',label:'Тёмное',disabled:true},{value:'c',label:'Ре · Дорийский'},{value:'d',label:'C♯ major'},{value:'e',label:'B♭ minor'}];
describe('searchable choices',()=>{
  it('filters by all terms, ignoring case, accents and musical accidental glyphs',()=>{
    expect(filterOptions(options,'  РЕ дор ')).toEqual([options[2]]);
    expect(filterOptions(options,'темное')).toEqual([options[1]]);
    expect(filterOptions(options,'c#')).toEqual([options[3]]);
    expect(filterOptions(options,'bb')).toEqual([options[4]]);
    expect(filterOptions(options,'nothing')).toEqual([]);
  });
  it('wraps keyboard navigation and skips disabled choices',()=>{
    expect(moveOption(options,0,1)).toBe(2);
    expect(moveOption(options,2,-1)).toBe(0);
    expect(moveOption(options,4,1)).toBe(0);
    expect(moveOption(options,0,-1)).toBe(4);
    expect(moveOption([],0,1)).toBe(-1);
    expect(moveOption([{value:'x',label:'x',disabled:true}],0,1)).toBe(-1);
  });
});
