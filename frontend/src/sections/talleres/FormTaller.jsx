// Formulario de un taller: nombre, grupo de unidades, lugar y los tres módulos con su inicio y su docente,
// junto con el contenido de cada módulo.
import { useState } from 'react';
import { Save } from 'lucide-react';
import { Alerta, Boton, Campo, Entrada, Seleccion } from '../../inventario/componentes/ui';
import MaterialEncuentro from './MaterialEncuentro';
import { fechaInput, inicioISO, regionIgual } from './fechas';
import { EtiquetaUP } from './GruposUP';

// Muestra el formulario y envía los datos del taller.
export default function FormTaller({ taller, grupoInicial, datos, session, onGuardar, onCancelar, ocupado }) {
  const [modulo, setModulo] = useState(1);
  const [f, setF] = useState(() => ({ nombre: taller?.nombre || grupoInicial?.nombre || '', nodo: taller?.nodo || grupoInicial?.ups[0]?.nodo || '', municipio: taller?.municipio || grupoInicial?.ups[0]?.municipio || '', lugar: taller?.lugar || '',
    grupo_id: String(taller?.grupo_id || grupoInicial?.id || ''),
    encuentros: [1,2,3].map((m) => ({ modulo: m, inicio: fechaInput(taller?.encuentros.find((e) => e.modulo === m)?.inicio), tallerista_sub: taller?.encuentros.find((e) => e.modulo === m)?.tallerista_sub || '' })),
  }));
  const grupo = datos.grupos.find((g) => String(g.id) === f.grupo_id);
  const region = grupo?.region;
  const poner = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }));
  const contenido = datos.contenidos.find((c) => regionIgual(c.region, region) && c.modulo === modulo);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onGuardar({ ...f, encuentros: f.encuentros.map((x) => ({ modulo: x.modulo, inicio: inicioISO(x.inicio), duracion_minutos: 180, tallerista_sub: x.tallerista_sub })) }); }}>
      <fieldset disabled={ocupado} className="grid min-w-0 gap-5">
        {!datos.grupos.length && <Alerta tono="aviso">Primero crea un grupo en “Grupos de UP”. Luego podrás seleccionarlo para programar sus módulos.</Alerta>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Grupo de UP" obligatorio ayuda="Selecciona el grupo creado. Sus UP se cargarán automáticamente.">
            <Seleccion required value={f.grupo_id} onChange={(e) => {
              const g = datos.grupos.find((x) => String(x.id) === e.target.value);
              setF((v) => ({ ...v, grupo_id: e.target.value, nombre: g?.nombre || v.nombre, nodo: g?.ups[0]?.nodo || '', municipio: g?.ups[0]?.municipio || '', encuentros: v.encuentros.map((x) => ({ ...x, tallerista_sub: '' })) }));
            }}><option value="">Elige un grupo de UP…</option>{datos.grupos.map((g) => <option key={g.id} value={g.id}>{g.nombre} · {g.region} · {g.ups.length} UP</option>)}</Seleccion>
          </Campo>
          <Campo etiqueta="Nombre de la programación" obligatorio><Entrada required maxLength={150} value={f.nombre} onChange={poner('nombre')} /></Campo>
          <Campo etiqueta="Nodo del lugar del taller" obligatorio ayuda={region ? `Región del grupo: ${region}` : 'Selecciona primero el grupo.'}>
            <Seleccion required value={f.nodo} onChange={poner('nodo')}><option value="">Elige…</option>{datos.nodos.filter((n) => regionIgual(n.region, region)).map((n) => <option key={n.nodo} value={n.nodo}>{n.nodo}</option>)}</Seleccion>
          </Campo>
          <Campo etiqueta="Municipio" obligatorio><Entrada required maxLength={100} value={f.municipio} onChange={poner('municipio')} /></Campo>
          <Campo etiqueta="Lugar del taller" obligatorio><Entrada required maxLength={200} value={f.lugar} onChange={poner('lugar')} /></Campo>
        </div>
        {grupo && <details className="rounded-lg border border-borde p-3 text-[13px]"><summary className="cursor-pointer font-semibold">Ver las {grupo.ups.length} UP del grupo</summary><ul className="mt-3 grid gap-3 sm:grid-cols-2">{grupo.ups.map((up) => <li key={up.id_up}><EtiquetaUP up={up} /></li>)}</ul></details>}
        <div className="border-t border-borde pt-4">
          <h3 className="mb-3 text-sm font-semibold text-marino">Programación · 3 módulos de 3 horas</h3>
          <div className="grid gap-4 lg:grid-cols-3">{f.encuentros.map((x, i) => <div key={x.modulo} className="grid content-start gap-3 rounded-lg border border-borde p-3">
            <Campo etiqueta={`Módulo ${x.modulo} · Fecha y hora`} obligatorio ayuda="Hora de Colombia. Duración: 3 horas.">
              <Entrada required type="datetime-local" value={x.inicio} onFocus={() => setModulo(x.modulo)} onChange={(e) => setF((v) => ({ ...v, encuentros: v.encuentros.map((a, j) => i === j ? { ...a, inicio: e.target.value } : a) }))} />
            </Campo>
            <Campo etiqueta={`Docente del módulo ${x.modulo}`} obligatorio ayuda={region ? 'Tallerista de la región del grupo.' : 'Selecciona primero el grupo.'}>
              <Seleccion required disabled={!grupo} value={x.tallerista_sub} onFocus={() => setModulo(x.modulo)} onChange={(e) => setF((v) => ({ ...v, encuentros: v.encuentros.map((a, j) => i === j ? { ...a, tallerista_sub: e.target.value } : a) }))}>
                <option value="">Elige el Tallerista…</option>
                {datos.talleristas.filter((t) => regionIgual(t.region, region)).map((t) => <option key={t.sub} value={t.sub}>{t.nombre}</option>)}
              </Seleccion>
            </Campo>
          </div>)}</div>
        </div>
        <div className="grid gap-3 border-t border-borde pt-4">
          <Campo etiqueta="Consultar el contenido de un módulo"><Seleccion value={modulo} onChange={(e) => setModulo(Number(e.target.value))}>{[1,2,3].map((m) => <option key={m} value={m}>Módulo {m}</option>)}</Seleccion></Campo>
          <MaterialEncuentro c={contenido} />
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-borde pt-4"><Boton variante="fantasma" onClick={onCancelar}>Cancelar</Boton><Boton tipo="submit" icono={Save} cargando={ocupado} disabled={!grupo}>Guardar programación</Boton></div>
      </fieldset>
    </form>
  );
}
