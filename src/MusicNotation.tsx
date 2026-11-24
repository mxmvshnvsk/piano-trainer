import { musicGlyphs, parseChordSymbol, rhythmGlyph } from './notation';
import './notation.css';

export function ChordSymbol({label,decorative=false}:{label:string;decorative?:boolean}) {
  const symbol=parseChordSymbol(label);
  if(!symbol)return <span>{label}</span>;
  return <span className="chord-symbol" role={decorative?undefined:'img'} aria-label={decorative?undefined:label} aria-hidden={decorative||undefined}>
    <span className="symbol-root symbol-part" aria-hidden="true">{symbol.root}</span>
    {symbol.accidental&&<svg className="symbol-accidental" viewBox="0 0 20 40" aria-hidden="true"><text className="engraving-glyph" x="2" y="33">{symbol.accidental==='♭'?musicGlyphs.flat:musicGlyphs.sharp}</text></svg>}
    {symbol.minor&&<span className="symbol-minor symbol-part" aria-hidden="true">m</span>}
    {symbol.quality&&<span className={`symbol-quality symbol-part ${symbol.raised?'raised':''}`} aria-hidden="true">{symbol.quality}</span>}
  </span>;
}
export function RhythmGlyph({duration,rest=false}:{duration:number;rest?:boolean}) {
  return <svg className="note-glyph" viewBox="0 0 46 52" aria-hidden="true">
    {rest&&duration>=2&&<path className="rest-reference-line" d="M8 25h28"/>}
    <text className="engraving-glyph" x={rest?15:10} y={rest?25:40}>{rhythmGlyph(duration,rest)}</text>
    {duration===1.5&&<text className="engraving-glyph" x="33" y={rest?25:40}>{musicGlyphs.dot}</text>}
  </svg>;
}
