import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { filterOptions, moveOption, type ChoiceOption } from './choice';
import './select.css';

type Props={value:string|number;onChange:(event:{target:{value:string}})=>void;children:ReactNode;disabled?:boolean;'aria-label'?:string;'aria-labelledby'?:string};
function text(node:ReactNode):string{return Children.toArray(node).map(n=>typeof n==='string'||typeof n==='number'?String(n):isValidElement<{children?:ReactNode}>(n)?text(n.props.children):'').join('');}
function optionsFrom(children:ReactNode):ChoiceOption[]{return Children.toArray(children).flatMap(node=>{
  if(!isValidElement<{value?:string|number;disabled?:boolean;children?:ReactNode}>(node))return [];
  if(node.type!=='option')return optionsFrom(node.props.children);
  const label=text(node.props.children);return [{value:String(node.props.value??label),label,disabled:node.props.disabled}];
});}
export function Select(props:Props) {
  const id=useId(),listId=`choices-${id}`;
  const root=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null),list=useRef<HTMLDivElement>(null);
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(-1);
  const [position,setPosition]=useState<CSSProperties>({});
  const options=optionsFrom(props.children),filtered=filterOptions(options,query);
  const selected=options.find(o=>o.value===String(props.value));
  const ru=document.documentElement.lang==='ru';
  const close=()=>{setOpen(false);setQuery('');};
  function show(){if(props.disabled)return;setQuery('');setActive(options.findIndex(o=>o.value===String(props.value)&&!o.disabled));setOpen(true);}
  function choose(index:number){const option=filtered[index];if(!option||option.disabled)return;props.onChange({target:{value:option.value}});close();input.current?.focus();}
  useEffect(()=>{if(props.disabled)close();},[props.disabled]);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node)&&!list.current?.contains(event.target as Node))close();};
    document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
  },[open]);
  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{
      const rect=root.current?.getBoundingClientRect();if(!rect)return;
      const viewport=window.visualViewport;
      const top=viewport?.offsetTop||0,height=viewport?.height||innerHeight,width=viewport?.width||innerWidth,left=viewport?.offsetLeft||0;
      if(rect.bottom<top||rect.top>top+height){close();return;}
      const below=top+height-rect.bottom-12,above=rect.top-top-12;
      const up=below<180&&above>below;
      const maxHeight=Math.min(280,Math.max(72,(up?above:below)));
      const popupWidth=Math.min(rect.width,width-16);
      setPosition({position:'fixed',width:popupWidth,maxHeight,left:Math.max(left+8,Math.min(rect.left,left+width-popupWidth-8)),...(up?{bottom:innerHeight-rect.top+6}:{top:rect.bottom+6})});
    };
    place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);window.visualViewport?.addEventListener('resize',place);window.visualViewport?.addEventListener('scroll',place);
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);window.visualViewport?.removeEventListener('resize',place);window.visualViewport?.removeEventListener('scroll',place);};
  },[open,filtered.length]);
  useLayoutEffect(()=>{
    const item=list.current?.querySelector<HTMLElement>('[data-active=true]');
    if(item&&list.current){if(item.offsetTop<list.current.scrollTop)list.current.scrollTop=item.offsetTop;else if(item.offsetTop+item.offsetHeight>list.current.scrollTop+list.current.clientHeight)list.current.scrollTop=item.offsetTop+item.offsetHeight-list.current.clientHeight;}
  },[active,open,query]);
  return <div className={`select-control ${open?'expanded':''} ${props.disabled?'disabled':''}`} ref={root} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))close();}}>
    <input ref={input} role="combobox" aria-label={props['aria-label']} aria-labelledby={props['aria-labelledby']} aria-expanded={open} aria-controls={open?listId:undefined} aria-autocomplete="list" aria-haspopup="listbox" aria-activedescendant={open&&active>=0&&filtered[active]?`${listId}-${active}`:undefined} disabled={props.disabled} value={open?query:selected?.label||''} placeholder={selected?.label||''} autoComplete="off" spellCheck={false} onFocus={show} onClick={()=>{if(!open)show();}} onChange={event=>{setQuery(event.target.value);setActive(moveOption(filterOptions(options,event.target.value),-1,1));setOpen(true);}} onKeyDown={event=>{
      if(event.nativeEvent.isComposing)return;
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(!open){show();if(event.key==='ArrowUp')setActive(moveOption(options,0,-1));}else setActive(moveOption(filtered,active,event.key==='ArrowDown'?1:-1));}
      else if(event.key==='Enter'){event.preventDefault();if(open)choose(active);else show();}
      else if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close();}
      else if(event.key==='Tab')close();
      else if(open&&!event.ctrlKey&&!event.metaKey&&['Home','End'].includes(event.key)&&!query){event.preventDefault();setActive(event.key==='Home'?moveOption(filtered,-1,1):moveOption(filtered,0,-1));}
    }}/>
    <button type="button" tabIndex={-1} disabled={props.disabled} aria-label={ru?'Открыть список':'Open options'} aria-hidden="true" onMouseDown={event=>event.preventDefault()} onClick={()=>{if(open)close();else{input.current?.focus();show();}}}><ChevronDown/></button>
    {open&&createPortal(<div ref={list} id={listId} className="select-popup" style={position} role="listbox" aria-label={props['aria-label']} aria-labelledby={props['aria-labelledby']}>
      {filtered.length?filtered.map((option,index)=><div key={option.value} id={`${listId}-${index}`} role="option" aria-selected={option.value===String(props.value)} aria-disabled={option.disabled||undefined} data-active={index===active} className={`select-option ${option.disabled?'disabled':''}`} onPointerMove={()=>{if(!option.disabled)setActive(index);}} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(index)}><span>{option.label}</span>{option.value===String(props.value)&&<Check aria-hidden="true"/>}</div>):<div className="select-empty" role="status">{ru?'Ничего не найдено':'No options found'}</div>}
    </div>,document.body)}
  </div>;
}
