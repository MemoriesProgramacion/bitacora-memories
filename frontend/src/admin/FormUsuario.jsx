// Formulario para crear un usuario o editar uno existente, dentro de un diálogo. Lo que se elige es el tipo de
// cuenta, del que salen los demás campos: una cuenta de campo pide su departamento y recibe solo el usuario;
// una de coordinación regional pide su territorio. Si el tipo nuevo vive en otra tabla, la cuenta se traslada y
// conserva su clave.
import { useRef, useState } from 'react';
import { RefreshCw, UserPlus, Save } from 'lucide-react';
import { Alerta, Boton, Campo, Entrada, EntradaClave, Seleccion } from '../inventario/componentes/ui';
import { ACCESO_DE_ROL, ROLES, generarClave } from './etiquetas';

// Las mismas reglas que exige el servidor, para avisar antes de enviar.
const USUARIO_VALIDO = /^[a-z0-9._-]{3,40}$/;
const CEDULA_VALIDA = /^\d{5,20}$/;
const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TELEFONO_VALIDO = /^[0-9+()\s-]{7,30}$/;
const MIN_CLAVE = 12;

// Genera las opciones de una lista desplegable y conserva el valor guardado aunque ya no esté entre ellas.
function Opciones({ lista = [], actual, vacio }) {
  const extra = actual && !lista.some((v) => String(v).toLowerCase() === String(actual).toLowerCase()) ? [actual] : [];
  return (
    <>
      <option value="">{vacio}</option>
      {[...extra, ...lista].map((v) => <option key={v} value={v}>{v}</option>)}
    </>
  );
}

// Quita tildes y mayúsculas para comparar, por ejemplo Atlántico con ATLANTICO.
const claveTexto = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

// Devuelve los valores únicos y ordenados de un campo entre las combinaciones que cumplen lo ya elegido.
function opcionesDe(combinaciones, campo, elegido) {
  const vistos = new Map();
  for (const c of combinaciones) {
    if (!c[campo]) continue;
    if (Object.entries(elegido).some(([k, v]) => v && claveTexto(c[k]) !== claveTexto(v))) continue;
    if (!vistos.has(claveTexto(c[campo]))) vistos.set(claveTexto(c[campo]), c[campo]);
  }
  return [...vistos.values()].sort((a, b) => String(a).localeCompare(String(b), 'es', { numeric: true }));
}

// Muestra el formulario con validación y envía los datos.
export default function FormUsuario({ usuario, roles, departamentos = [], territorio = {}, bodegas = [], onGuardar, onCancelar }) {
  const editando = Boolean(usuario);
  const [datos, setDatos] = useState(() => ({
    rol: usuario?.rol || (roles.some((r) => r.rol === 'coordinador') ? 'coordinador' : roles[0]?.rol || 'coordinador'),
    usuario: usuario?.usuario || '',
    nombre: usuario?.nombre || '',
    cedula: usuario?.cedula || '',
    correo: usuario?.correo || '',
    telefono: usuario?.telefono || '',
    bodega_id: usuario?.bodega_id ? String(usuario.bodega_id) : '',
    departamento: usuario?.origen === 'coordinador' ? (usuario.departamento || '') : '',
    region: usuario?.origen === 'coordinador' ? (usuario.region || '') : '',
    modalidad: usuario?.origen === 'coordinador' ? (usuario.modalidad || '') : '',
    nodo: usuario?.origen === 'coordinador' ? (usuario.nodo || '') : '',
    triada: '',
    clave: '',
  }));
  const [enviando, setEnviando] = useState(false);
  const [errores, setErrores] = useState({});
  const formulario = useRef(null);

  const cambiar = (campo) => (e) => {
    setDatos((d) => ({ ...d, [campo]: e.target.value }));
    setErrores((er) => (er[campo] ? { ...er, [campo]: undefined } : er));
  };
  const invalido = (campo) => (errores[campo] ? { 'aria-invalid': true } : {});

  const combinaciones = territorio.combinaciones || [];
  const ORDEN = ['region', 'departamento', 'modalidad', 'nodo'];
  const elegirTerritorio = (campo) => (e) => setDatos((d) => {
    const nuevo = { ...d, [campo]: e.target.value };
    const arriba = {};
    for (const k of ORDEN) {
      if (k === campo) { arriba[k] = nuevo[k]; continue; }
      if (ORDEN.indexOf(k) > ORDEN.indexOf(campo)) {
        const ok = !nuevo[k] || opcionesDe(combinaciones, k, arriba).some((v) => claveTexto(v) === claveTexto(nuevo[k]));
        if (!ok) nuevo[k] = '';
      }
      arriba[k] = nuevo[k];
    }
    return nuevo;
  });
  const opcionesTerritorio = (campo) => {
    const arriba = {};
    for (const k of ORDEN) { if (k === campo) break; arriba[k] = datos[k]; }
    return opcionesDe(combinaciones, campo, arriba);
  };
  const nombreOficial = (v) => departamentos.find((d) => claveTexto(d.nombre) === claveTexto(v))?.nombre || v;
  const listaDepartamentos = combinaciones.some((c) => c.departamento)
    ? [...new Set(opcionesTerritorio('departamento').map(nombreOficial))]
    : departamentos.map((d) => d.nombre);

  const origenNuevo = roles.find((r) => r.rol === datos.rol)?.origen;
  const esGestor = origenNuevo === 'gestor';
  const esLocal = ['coordinador', 'tecnico_administrativo'].includes(datos.rol);
  const esTallerista = datos.rol === 'tallerista';
  const sinTerritorio = esLocal && ![datos.region, datos.departamento, datos.modalidad, datos.nodo]
    .some((v) => String(v).trim());
  const cambiaRol = editando && datos.rol !== usuario.rol;
  const traslada = editando && origenNuevo !== usuario.origen;
  const datosDeCuentaNueva = !editando || traslada;

  const depto = departamentos.find((d) => d.nombre === datos.departamento);
  const claveObligatoria = datosDeCuentaNueva && !esGestor && (!editando || usuario.clave_estado === 'cedula');

  const validar = () => {
    const er = {};
    const t = (v) => String(v || '').trim();
    const pideUsuario = !(esGestor && datosDeCuentaNueva) && (!editando || traslada);

    if (esGestor && datosDeCuentaNueva && !datos.departamento) er.departamento = 'Por favor seleccione el departamento.';
    if (pideUsuario) {
      if (!t(datos.usuario)) er.usuario = 'Por favor ingrese el usuario.';
      else if (!USUARIO_VALIDO.test(t(datos.usuario).toLowerCase())) {
        er.usuario = 'El usuario debe tener de 3 a 40 caracteres: letras, números, punto, guion o guion bajo.';
      }
    }
    if (!t(datos.nombre)) er.nombre = 'Por favor ingrese el nombre.';
    if (esTallerista && !datos.region) er.region = 'Selecciona la región del Tallerista.';
    if (datos.rol === 'bodeguero' && !datos.bodega_id) er.bodega_id = 'Selecciona una bodega municipal.';
    if (esGestor) {
      if (!t(datos.cedula)) er.cedula = 'Por favor ingrese la cédula.';
      else if (!CEDULA_VALIDA.test(t(datos.cedula))) er.cedula = 'La cédula debe tener solo números (de 5 a 20).';
      if (t(datos.telefono) && !TELEFONO_VALIDO.test(t(datos.telefono))) {
        er.telefono = 'Por favor ingrese un teléfono válido (solo números, de 7 a 30 caracteres).';
      }
    }
    if (origenNuevo !== 'inventario' && t(datos.correo) && !CORREO_VALIDO.test(t(datos.correo))) {
      er.correo = 'Por favor ingrese un correo válido, por ejemplo nombre@dominio.co.';
    }
    if (datosDeCuentaNueva) {
      if (claveObligatoria && !datos.clave) er.clave = 'Por favor ingrese la clave.';
      else if (datos.clave && datos.clave.length < MIN_CLAVE) {
        er.clave = `La clave debe tener al menos ${MIN_CLAVE} caracteres.`;
      }
    }
    return er;
  };

  const irAlError = () => requestAnimationFrame(
    () => formulario.current?.querySelector('[aria-invalid="true"]')?.focus(),
  );

  const errorDelServidor = (err) => {
    const campo = err?.datos?.campo;
    if (!campo) return false;
    setErrores((er) => ({ ...er, [campo]: err.message }));
    irAlError();
    return true;
  };

  const enviar = async (e) => {
    e.preventDefault();
    const er = validar();
    setErrores(er);
    if (Object.keys(er).length) {
      irAlError();
      return;
    }
    setEnviando(true);
    try {
      const envio = {
        rol: datos.rol,
        nombre: datos.nombre,
        cedula: datos.cedula,
        correo: datos.correo,
        telefono: datos.telefono,
        ...(datos.rol === 'bodeguero' ? { bodega_id: datos.bodega_id } : {}),
      };
      if (esTallerista) Object.assign(envio, { region: datos.region });
      if (esLocal) {
        Object.assign(envio, {
          region: datos.region,
          departamento: datos.departamento,
          modalidad: datos.modalidad,
          nodo: datos.nodo,
        });
      }
      if (datosDeCuentaNueva) {
        Object.assign(envio, {
          usuario: datos.usuario,
          ...(esLocal || esTallerista ? {} : { departamento: datos.departamento, region: datos.region }),
          triada: datos.triada,
          clave: datos.clave,
        });
      }
      await onGuardar(envio, errorDelServidor);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form ref={formulario} onSubmit={enviar} noValidate className="flex flex-col gap-4">
      <p className="text-[12px] text-gris">
        Los campos con <span aria-hidden="true" className="font-semibold text-rojo-txt">*</span>
        <span className="sr-only">asterisco</span> son obligatorios.
      </p>

      <Campo etiqueta="Rol" obligatorio ayuda={`Al entrar verá: ${ACCESO_DE_ROL[datos.rol]}.`}>
        <Seleccion value={datos.rol} onChange={cambiar('rol')}>
          {roles.map((r) => <option key={r.rol} value={r.rol}>{ROLES[r.rol]}</option>)}
        </Seleccion>
      </Campo>

      {esTallerista && (
        <Campo etiqueta="Región del Tallerista" obligatorio error={errores.region}
          ayuda="Consultará Eventos y contenidos de esta región; registrará sus propios talleres.">
          <Seleccion value={datos.region} onChange={cambiar('region')} {...invalido('region')}>
            <Opciones lista={territorio.regiones || []} actual={datos.region} vacio="Elige una región…" />
          </Seleccion>
        </Campo>
      )}

      {datos.rol === 'bodeguero' && (
        <Campo etiqueta="Bodega municipal asignada" obligatorio error={errores.bodega_id}
          ayuda="Las entregas descontarán únicamente los artículos de esta bodega.">
          <Seleccion value={datos.bodega_id} onChange={cambiar('bodega_id')} {...invalido('bodega_id')}>
            <option value="">Elige una bodega municipal…</option>
            {bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
          </Seleccion>
        </Campo>
      )}

      {cambiaRol && (
        <Alerta tono="aviso">
          Al guardar se cierran sus sesiones. Cuando vuelva a entrar con su clave solo verá lo de su rol nuevo
          ({ACCESO_DE_ROL[datos.rol]}).
          {traslada && esGestor && ' Su usuario de acceso pasará a ser el nodo del departamento que elijas.'}
          {traslada && usuario.origen === 'gestor' && ' Sus unidades productivas quedan sin gestor hasta que se les asigne uno nuevo.'}
        </Alerta>
      )}

      {esGestor && datosDeCuentaNueva ? (
        <>
          <Campo
            etiqueta="Departamento"
            obligatorio
            ayuda="De aquí sale el usuario del gestor: las cinco primeras letras y un número."
            error={errores.departamento}
          >
            <Seleccion value={datos.departamento} onChange={cambiar('departamento')} required {...invalido('departamento')}>
              <option value="">Elige el departamento…</option>
              {departamentos.map((d) => (
                <option key={d.nombre} value={d.nombre}>
                  {d.nombre}{d.gestores ? ` (${d.gestores} gestor${d.gestores > 1 ? 'es' : ''})` : ''}
                </option>
              ))}
            </Seleccion>
          </Campo>
          {depto && (
            <Alerta tono="info">
              Su usuario de acceso será <strong className="cifras">{depto.siguiente}</strong>
              {depto.gestores > 0 && ` (ya hay ${depto.gestores} en ${depto.nombre}, este es el siguiente)`}.
            </Alerta>
          )}
        </>
      ) : (
        <Campo
          etiqueta="Usuario"
          obligatorio={!editando || traslada}
          ayuda={editando && !traslada
            ? 'El nombre de acceso no se puede cambiar.'
            : '3 a 40 caracteres: letras, números, punto, guion o guion bajo.'}
          error={errores.usuario}
        >
          <Entrada
            value={datos.usuario}
            onChange={cambiar('usuario')}
            disabled={editando && !traslada}
            required
            maxLength={40}
            autoCapitalize="none"
            spellCheck={false}
            autoComplete="off"
            {...invalido('usuario')}
          />
        </Campo>
      )}

      <Campo etiqueta="Nombre completo" obligatorio error={errores.nombre}>
        <Entrada value={datos.nombre} onChange={cambiar('nombre')} required maxLength={120} {...invalido('nombre')} />
      </Campo>

      {esLocal && (
        <fieldset className="flex flex-col gap-4 rounded-xl border border-borde p-4">
          <legend className="px-1 text-[13px] font-semibold text-marca">Territorio</legend>
          <p className="text-[13px] text-gris-txt">
            Solo verá las unidades productivas que cumplan lo que llenes aquí (y sus citas, visitas, entregas y carritos).{datos.rol === 'tecnico_administrativo' && ' Este rol solo consulta: no crea, modifica ni elimina nada.'}
            Llena al menos un dato: sin territorio no vería nada.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Región">
              <Seleccion value={datos.region} onChange={elegirTerritorio('region')}>
                <Opciones lista={opcionesTerritorio('region')} actual={datos.region} vacio="Todas" />
              </Seleccion>
            </Campo>
            <Campo etiqueta="Departamento">
              <Seleccion value={datos.departamento} onChange={elegirTerritorio('departamento')}>
                <Opciones lista={listaDepartamentos} actual={datos.departamento} vacio="Todos" />
              </Seleccion>
            </Campo>
            <Campo etiqueta="Modalidad">
              <Seleccion value={datos.modalidad} onChange={elegirTerritorio('modalidad')}>
                <Opciones lista={opcionesTerritorio('modalidad')} actual={datos.modalidad} vacio="Todas" />
              </Seleccion>
            </Campo>
            <Campo etiqueta="Nodo">
              <Seleccion value={datos.nodo} onChange={elegirTerritorio('nodo')}>
                <Opciones lista={opcionesTerritorio('nodo')} actual={datos.nodo} vacio="Todos" />
              </Seleccion>
            </Campo>
          </div>
          {sinTerritorio && <Alerta tono="aviso">Falta al menos un dato de territorio.</Alerta>}
        </fieldset>
      )}

      {(origenNuevo === 'coordinador' || esGestor) && (
        <Campo
          etiqueta="Cédula"
          obligatorio={esGestor}
          ayuda={esGestor ? 'Solo números. Es la clave inicial del gestor.' : undefined}
          error={errores.cedula}
        >
          <Entrada
            value={datos.cedula}
            onChange={cambiar('cedula')}
            required={esGestor}
            maxLength={20}
            inputMode="numeric"
            pattern={esGestor ? '[0-9]{5,20}' : undefined}
            {...invalido('cedula')}
          />
        </Campo>
      )}

      {esGestor && (
        <Campo etiqueta="Teléfono (opcional)" error={errores.telefono}>
          <Entrada value={datos.telefono} onChange={cambiar('telefono')} maxLength={30} inputMode="tel" {...invalido('telefono')} />
        </Campo>
      )}

      {esGestor && datosDeCuentaNueva && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Región (opcional)" ayuda="Si la dejas vacía se toma la de otro gestor del mismo departamento.">
            <Entrada value={datos.region} onChange={cambiar('region')} maxLength={100} />
          </Campo>
          <Campo etiqueta="Tríada (opcional)">
            <Entrada value={datos.triada} onChange={cambiar('triada')} maxLength={100} />
          </Campo>
        </div>
      )}

      {origenNuevo !== 'inventario' && (
        <Campo etiqueta="Correo (opcional)" error={errores.correo}>
          <Entrada type="email" value={datos.correo} onChange={cambiar('correo')} maxLength={150} {...invalido('correo')} />
        </Campo>
      )}

      {datosDeCuentaNueva && (
        <>
          <Campo
            etiqueta={editando ? 'Clave nueva' : 'Clave inicial'}
            obligatorio={claveObligatoria}
            ayuda={
              esGestor
                ? 'Opcional. Si la dejas vacía, su clave será su cédula.'
                : claveObligatoria
                  ? 'Mínimo 12 caracteres. Anótala para entregársela a la persona.'
                  : 'Opcional. Si la dejas vacía conserva la clave que ya tenía.'
            }
            error={errores.clave}
          >
            <EntradaClave
              autoComplete="new-password"
              required={claveObligatoria}
              minLength={datos.clave ? 12 : undefined}
              maxLength={128}
              value={datos.clave}
              onChange={cambiar('clave')}
              {...invalido('clave')}
            />
          </Campo>
          <div>
            <Boton variante="fantasma" tamano="sm" icono={RefreshCw}
              onClick={() => {
                setDatos((d) => ({ ...d, clave: generarClave() }));
                setErrores((er) => ({ ...er, clave: undefined }));
              }}>
              Generar al azar
            </Boton>
          </div>
        </>
      )}

      <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Boton variante="fantasma" onClick={onCancelar}>Cancelar</Boton>
        <Boton tipo="submit" icono={editando ? Save : UserPlus} cargando={enviando} disabled={sinTerritorio}>
          {editando ? 'Guardar cambios' : 'Crear usuario'}
        </Boton>
      </div>
    </form>
  );
}
