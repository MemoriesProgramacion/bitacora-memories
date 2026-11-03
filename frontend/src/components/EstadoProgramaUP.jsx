// Muestra el retiro o reemplazo de la unidad, con su causal, y el evento de cierre al que asistió, tal como los
// trae el detalle de la unidad. Solo se muestra si hay algo registrado.
import { Insignia } from '../inventario/componentes/ui';
import { CAUSALES } from '../lib/alistamiento';
import { diaColombia } from '../lib/carrito';

// Muestra el retiro o reemplazo y el cierre de la unidad.
export default function EstadoProgramaUP({ retiro, cierre }) {
  if (!retiro && !cierre) return null;
  return (
    <div className="grid gap-2 text-[13px]">
      {retiro && (
        <p className="break-words">
          <Insignia tono={retiro.tipo === 'reemplazo' ? 'alerta' : 'error'}>{retiro.tipo === 'reemplazo' ? 'Reemplazada' : 'Retirada'}</Insignia>{' '}
          {CAUSALES[retiro.causal] || retiro.causal} · {diaColombia(retiro.creado_en)} · registró {retiro.registrado_por}
          {retiro.tipo === 'reemplazo' && <> · entra <strong>{retiro.persona_entra?.nombre || retiro.id_unico_entra}</strong> con concepto del Comité Técnico del {retiro.comite?.fecha}</>}
          {retiro.ticket && <> · ticket {retiro.ticket}</>}
          {retiro.observaciones ? ` · ${retiro.observaciones}` : ''}
        </p>
      )}
      {cierre && <p><Insignia tono="ok">Cierre</Insignia> Asistió al evento de cierre de {cierre.departamento} el {cierre.fecha}{cierre.lugar ? ` (${cierre.lugar})` : ''}.</p>}
    </div>
  );
}
