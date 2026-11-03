// Avisos para todos los usuarios y modo mantenimiento, en el que todos consultan y nadie guarda salvo quien
// tiene acceso total. Los avisos vigentes salen como una franja arriba. También administra la lista de correos
// que siguen todos los tickets.
import { useState } from 'react';
import { Mail, Megaphone, Trash2, Wrench } from 'lucide-react';
import {
  Alerta, AreaTexto, Boton, Cargando, Campo, Entrada, Insignia, Seleccion, Tarjeta, useAvisos,
} from '../inventario/componentes/ui';
import Encabezado from '../inventario/componentes/Encabezado';
import { AvisoVistaPrevia } from '../components/AvisoGlobal';
import { admin } from './apiAdmin';
import { useCarga } from './useCarga';
import { fechaHora } from './etiquetas';

const NIVELES = [
  { id: 'info', texto: 'Informativo', tono: 'neutro' },
  { id: 'alerta', texto: 'Alerta', tono: 'alerta' },
  { id: 'urgente', texto: 'Urgente', tono: 'error' },
];

// Devuelve mañana a esta hora en el formato del campo datetime-local, para el valor inicial de «hasta».
const enHoras = (h) => {
  const d = new Date(Date.now() + h * 3600000);
  d.setMinutes(0, 0, 0);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`;
};

// Muestra el formulario para publicar avisos, la lista de vigentes, el interruptor de mantenimiento y la lista
// de correos.
export default function Avisos() {
  const { avisar } = useAvisos();
  const { datos, cargando, recargar } = useCarga(() => admin.config(), []);
  const [texto, setTexto] = useState('');
  const [nivel, setNivel] = useState('info');
  const [hasta, setHasta] = useState(enHoras(24));
  const [textoMant, setTextoMant] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [correos, setCorreos] = useState(null);

  const hacer = async (cuerpo, mensaje) => {
    setOcupado(true);
    try {
      await admin.accionConfig(cuerpo);
      avisar(mensaje);
      await recargar();
      return true;
    } catch (err) {
      avisar(err.message, 'error');
      return false;
    } finally {
      setOcupado(false);
    }
  };

  const publicar = async (e) => {
    e.preventDefault();
    if (!texto.trim()) return;
    if (await hacer({ accion: 'publicar_aviso', texto: texto.trim(), nivel, hasta: new Date(hasta).toISOString() },
      'Aviso publicado. Lo verán todos al abrir la Bitácora.')) setTexto('');
  };

  if (!datos) return <Cargando />;
  const mantenimiento = !!datos.mantenimiento;
  const textoCorreos = correos ?? (datos.correos_tickets || []).join('\n');

  return (
    <>
      <Encabezado titulo="Avisos y mantenimiento" descripcion="Mensajes para todos los usuarios de la Bitácora y la herramienta de emergencia." />

      <Tarjeta className="mb-5">
        <h3 className="mb-3 flex items-center gap-2 text-[15px] font-bold text-marca"><Megaphone size={17} aria-hidden="true" /> Publicar un aviso</h3>
        <form onSubmit={publicar} className="grid gap-3 sm:grid-cols-[1fr_160px_210px]">
          <Campo etiqueta="Texto (máx. 300 caracteres)" className="sm:col-span-3">
            <Entrada value={texto} maxLength={300} onChange={(e) => setTexto(e.target.value)} placeholder="Ej. Hoy a las 6 p. m. hay mantenimiento" />
          </Campo>
          <Campo etiqueta="Nivel">
            <Seleccion value={nivel} onChange={(e) => setNivel(e.target.value)}>
              {NIVELES.map((n) => <option key={n.id} value={n.id}>{n.texto}</option>)}
            </Seleccion>
          </Campo>
          <Campo etiqueta="Visible hasta">
            <Entrada type="datetime-local" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </Campo>
          <div className="flex items-end"><Boton tipo="submit" cargando={ocupado} disabled={!texto.trim()}>Publicar</Boton></div>
        </form>
        {texto.trim() && (
          <div className="mt-4 overflow-hidden rounded-lg border border-borde">
            <AvisoVistaPrevia aviso={{ nivel, texto: texto.trim() }} />
          </div>
        )}
      </Tarjeta>

      <Tarjeta className="mb-5">
        <h3 className="mb-3 text-[15px] font-bold text-marca">Avisos publicados</h3>
        {!datos.avisos.length ? (
          <p className="text-[13px] text-gris-txt">No hay avisos vigentes.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {datos.avisos.map((a) => {
              const n = NIVELES.find((x) => x.id === a.nivel) || NIVELES[0];
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-borde p-3">
                  <Insignia tono={n.tono}>{n.texto}</Insignia>
                  <span className="min-w-0 flex-1 text-[13px] [overflow-wrap:anywhere]">{a.texto}</span>
                  <span className="text-[12px] text-gris-txt">hasta {fechaHora(a.hasta)}</span>
                  <Boton variante="fantasma" icono={Trash2} cargando={ocupado}
                    onClick={() => hacer({ accion: 'retirar_aviso', id: a.id }, 'Aviso retirado.')}>Retirar</Boton>
                </li>
              );
            })}
          </ul>
        )}
      </Tarjeta>

      <Tarjeta className="mb-5">
        <h3 className="mb-1 flex items-center gap-2 text-[15px] font-bold text-marca"><Mail size={17} aria-hidden="true" /> Correos que siguen los tickets</h3>
        <p className="mb-3 text-[13px] text-gris-txt">
          Reciben cada movimiento de todos los tickets (consecutivo, etapa, región, descripción, estado y archivos), por ejemplo el Profesional administrativo y financiero. Además se avisa al solicitante, al asignado y a la coordinación de la región.
        </p>
        <Campo etiqueta="Un correo por línea (máximo 20)" className="mb-3">
          <AreaTexto rows={3} value={textoCorreos} onChange={(e) => setCorreos(e.target.value)} placeholder="financiero@entidad.gov.co" />
        </Campo>
        <Boton cargando={ocupado} onClick={async () => { if (await hacer({ accion: 'correos_tickets', correos: textoCorreos }, 'Correos guardados.')) setCorreos(null); }}>Guardar los correos</Boton>
      </Tarjeta>

      <Tarjeta>
        <h3 className="mb-1 flex items-center gap-2 text-[15px] font-bold text-marca"><Wrench size={17} aria-hidden="true" /> Modo mantenimiento</h3>
        <p className="mb-3 text-[13px] text-gris-txt">
          Con el mantenimiento activo todos los usuarios consultan pero nadie guarda; solo el superadmin puede escribir. Salir y entrar siguen funcionando.
        </p>
        {mantenimiento && <Alerta tono="aviso" className="mb-3">El mantenimiento está ACTIVO: los usuarios no pueden guardar.</Alerta>}
        {!mantenimiento && (
          <Campo etiqueta="Mensaje para los usuarios (opcional)" className="mb-3">
            <Entrada value={textoMant} maxLength={300} onChange={(e) => setTextoMant(e.target.value)} placeholder="Ej. Volvemos a las 8 p. m." />
          </Campo>
        )}
        <Boton variante={mantenimiento ? 'principal' : 'peligro'} cargando={ocupado}
          onClick={() => hacer({ accion: 'mantenimiento', activo: !mantenimiento, texto: textoMant.trim() },
            mantenimiento ? 'Mantenimiento apagado.' : 'Mantenimiento activado.')}>
          {mantenimiento ? 'Apagar mantenimiento' : 'Activar mantenimiento'}
        </Boton>
      </Tarjeta>
    </>
  );
}
