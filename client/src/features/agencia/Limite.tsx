import { claseCampo, estiloCampo, OPCIONES_LIMITE, textoDeLimite, limiteDeTexto } from './comun';

// Cuántos números de WhatsApp o negocios puede tener una cuenta (null = sin límite).
export default function Limite({ valor, onCambiar, uno, varios }: { valor: number | null | undefined; onCambiar: (n: number | null) => void; uno: string; varios: string }) {
  const actual = textoDeLimite(valor);
  const opciones: string[] = (OPCIONES_LIMITE as readonly string[]).includes(actual) ? [...OPCIONES_LIMITE] : [actual, ...OPCIONES_LIMITE];
  return (
    <select value={actual} onChange={(e) => onCambiar(limiteDeTexto(e.target.value))} className={claseCampo} style={estiloCampo}>
      {opciones.map((o) => (
        <option key={o} value={o}>{o === '' ? `${varios[0].toUpperCase()}${varios.slice(1)} sin límite` : `${o} ${o === '1' ? uno : varios}`}</option>
      ))}
    </select>
  );
}
