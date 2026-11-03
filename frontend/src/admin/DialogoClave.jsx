// Ventana para asignar una clave nueva a un usuario. Las claves se guardan cifradas y no se pueden leer
// después, por eso se ofrece generar una al azar y copiarla antes de guardar.
import { useEffect, useState } from 'react';
import { Copy, IdCard, RefreshCw, ShieldCheck } from 'lucide-react';
import { Boton, Campo, Dialogo, EntradaClave, Alerta, useAvisos } from '../inventario/componentes/ui';
import { generarClave } from './etiquetas';

// Muestra el diálogo para escribir o generar una clave y confirmarla.
export default function DialogoClave({ usuario, onCerrar, onGuardar, onCedula }) {
  const { avisar } = useAvisos();
  const [clave, setClave] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { setClave(''); }, [usuario]);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(clave);
      avisar('Clave copiada.');
    } catch {
      avisar('No se pudo copiar. Selecciónala y cópiala a mano.', 'error');
    }
  };

  const enviar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    try {
      await onGuardar(clave);
    } finally {
      setGuardando(false);
    }
  };

  const esGestorConCedula = usuario?.origen === 'gestor' && usuario.cedula;

  return (
    <Dialogo abierto={Boolean(usuario)} titulo={`Clave de ${usuario?.usuario || ''}`} onCerrar={onCerrar}>
      <form onSubmit={enviar} className="flex flex-col gap-4">
        <Alerta tono="info">
          Las claves se guardan cifradas: no se pueden ver, solo cambiar. Anota la nueva antes de guardar y
          entrégasela a la persona. Al guardar se cierran sus sesiones abiertas.
        </Alerta>

        <Campo etiqueta="Clave nueva" ayuda="Mínimo 12 caracteres. Evita claves comunes y el nombre de usuario.">
          <EntradaClave
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            value={clave}
            onChange={(e) => setClave(e.target.value)}
          />
        </Campo>

        <div className="flex flex-wrap gap-2">
          <Boton variante="fantasma" tamano="sm" icono={RefreshCw} onClick={() => setClave(generarClave())}>
            Generar al azar
          </Boton>
          <Boton variante="fantasma" tamano="sm" icono={Copy} disabled={!clave} onClick={copiar}>
            Copiar
          </Boton>
        </div>

        <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {esGestorConCedula && (
            <Boton variante="fantasma" icono={IdCard} onClick={onCedula}>
              Volver a la cédula
            </Boton>
          )}
          <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
          <Boton tipo="submit" icono={ShieldCheck} cargando={guardando} disabled={clave.length < 12}>
            Guardar clave
          </Boton>
        </div>
      </form>
    </Dialogo>
  );
}
