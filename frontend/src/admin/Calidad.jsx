// Calidad de datos: revisa en el navegador las unidades productivas y las cuentas de campo ya cargadas para
// encontrar errores de los cargues antes de que los vea quien las atiende. No escribe nada.
import { useMemo } from 'react';
import { ClipboardCheck, RefreshCw } from 'lucide-react';
import { Boton, Cargando, Celda, Fila, Indicador, Insignia, Tabla, Tarjeta } from '../inventario/componentes/ui';
import Encabezado from '../inventario/componentes/Encabezado';
import { apiGeneral } from '../inventario/lib/api';
import { useCarga } from './useCarga';

const vacio = (v) => v === undefined || v === null || String(v).trim() === '';
const mayus = (v) => String(v ?? '').trim().toUpperCase();

// Columnas que deberían estar siempre llenas, con su nombre en la API y su título.
const COLUMNAS = [
  ['up_nombre', 'Nombre de la U.P.'],
  ['rep_documento', 'Documento del representante'],
  ['nodo', 'Nodo (gestor asignado)'],
  ['up_modalidad', 'Modalidad'],
  ['up_departamento', 'Departamento'],
  ['up_municipio', 'Municipio'],
  ['region', 'Región'],
  ['triada', 'Tríada'],
];

// Recorre los datos y devuelve los problemas encontrados.
export function revisar(unidades, gestores) {
  const nodosGestor = new Set(gestores.map((g) => mayus(g.nodo)));
  const nodosConUp = new Set(unidades.map((u) => mayus(u.nodo)).filter(Boolean));
  const porDoc = new Map();
  unidades.filter((u) => !vacio(u.rep_documento)).forEach((u) => {
    const k = String(u.rep_documento).trim();
    porDoc.set(k, [...(porDoc.get(k) || []), u]);
  });
  const problemas = [
    { id: 'sin_nodo', tono: 'error', titulo: 'U.P. sin gestor asignado', explica: 'No tienen nodo: ningún gestor las ve.',
      filas: unidades.filter((u) => vacio(u.nodo)).map((u) => [u.id_unico, u.up_nombre, '—']) },
    { id: 'nodo_huerfano', tono: 'error', titulo: 'U.P. con un nodo que no tiene gestor', explica: 'El nodo no existe entre los gestores (o está mal escrito).',
      filas: unidades.filter((u) => !vacio(u.nodo) && !nodosGestor.has(mayus(u.nodo))).map((u) => [u.id_unico, u.up_nombre, u.nodo]) },
    { id: 'duplicadas', tono: 'alerta', titulo: 'Documento del representante repetido', explica: 'Dos o más U.P. con el mismo documento.',
      filas: [...porDoc.values()].filter((l) => l.length > 1).flat().map((u) => [u.id_unico, u.up_nombre, u.rep_documento]) },
    { id: 'gestores_sin_up', tono: 'alerta', titulo: 'Gestores sin U.P.', explica: 'Entran a la Bitácora y no ven nada.',
      filas: gestores.filter((g) => !nodosConUp.has(mayus(g.nodo))).map((g) => ['—', g.nombre, g.nodo]) },
  ];
  const vaciosPorColumna = COLUMNAS.map(([campo, nombre]) => ({
    nombre, vacios: unidades.filter((u) => vacio(u[campo])).length,
  }));
  return { problemas, vaciosPorColumna };
}

// Muestra el resultado de la revisión de calidad.
export default function Calidad() {
  const { datos, cargando, recargar } = useCarga(async () => {
    const [u, g] = await Promise.all([apiGeneral.get('/unidades'), apiGeneral.get('/gestores')]);
    return { unidades: u.items || [], gestores: g.items || [] };
  }, []);

  const r = useMemo(() => (datos ? revisar(datos.unidades, datos.gestores) : null), [datos]);
  const total = datos?.unidades.length || 0;
  const conProblemas = r ? r.problemas.reduce((a, p) => a + p.filas.length, 0) : 0;

  return (
    <>
      <Encabezado titulo="Calidad de datos" descripcion="Revisa las unidades productivas y los gestores cargados para encontrar errores de los cargues.">
        <Boton variante="fantasma" icono={RefreshCw} cargando={cargando} onClick={recargar}>Actualizar</Boton>
      </Encabezado>

      {!r ? <Cargando /> : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <Indicador etiqueta="Unidades productivas" valor={total} icono={ClipboardCheck} />
            <Indicador etiqueta="Gestores" valor={datos.gestores.length} />
            <Indicador etiqueta="Problemas encontrados" valor={conProblemas} tono={conProblemas ? 'alerta' : 'ok'} />
          </div>

          {r.problemas.map((p) => (
            <Tarjeta key={p.id} className="mb-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="text-[15px] font-bold text-marca">{p.titulo}</h3>
                <Insignia tono={p.filas.length ? p.tono : 'ok'}>{p.filas.length ? `${p.filas.length}` : 'Sin problemas'}</Insignia>
              </div>
              <p className="mb-2 text-[13px] text-gris-txt">{p.explica}</p>
              {p.filas.length > 0 && (
                <Tabla cabeceras={['ID', 'Unidad / gestor', 'Dato']}>
                  {p.filas.slice(0, 50).map((f, i) => (
                    <Fila key={`${p.id}-${i}`}>
                      <Celda className="cifras">{f[0]}</Celda>
                      <Celda>{f[1] || '—'}</Celda>
                      <Celda>{f[2] || '—'}</Celda>
                    </Fila>
                  ))}
                </Tabla>
              )}
              {p.filas.length > 50 && <p className="mt-2 text-[12px] text-gris-txt">Se muestran las primeras 50 de {p.filas.length}.</p>}
            </Tarjeta>
          ))}

          <Tarjeta>
            <h3 className="mb-2 text-[15px] font-bold text-marca">Campos vacíos</h3>
            <Tabla cabeceras={['Columna', 'Vacíos', '% de las U.P.']}>
              {r.vaciosPorColumna.map((c) => (
                <Fila key={c.nombre}>
                  <Celda>{c.nombre}</Celda>
                  <Celda className="cifras">{c.vacios}</Celda>
                  <Celda className="cifras">{total ? `${Math.round((c.vacios / total) * 100)} %` : '—'}</Celda>
                </Fila>
              ))}
            </Tabla>
          </Tarjeta>
        </>
      )}
    </>
  );
}
