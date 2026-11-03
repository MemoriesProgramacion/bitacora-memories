// Hook que carga el carrito de una iniciativa y ofrece las acciones para cambiarlo. Cada acción manda el cambio
// al servidor y se queda con el carrito que este devuelve, así la pantalla siempre muestra lo que de verdad
// quedó guardado.
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGeneral, qs } from '../../inventario/lib/api';
import { useAvisos } from '../../inventario/componentes/ui';

// Devuelve el carrito, el estado de carga y las acciones para modificarlo.
export function useCarrito(idUnico) {
  const { avisar } = useAvisos();
  const [vista, setVista] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const vigente = useRef(idUnico);
  vigente.current = idUnico;
  const tomar = useCallback((r) => {
    if (r?.carrito?.id_unico == null || String(r.carrito.id_unico) === String(vigente.current)) setVista(r);
  }, []);

  const recargar = useCallback(async () => {
    if (!idUnico) { setVista(null); return; }
    setCargando(true);
    try {
      tomar(await apiGeneral.get(`/carritos/detalle${qs({ id_unico: idUnico })}`));
    } catch (err) {
      if (vigente.current === idUnico) { avisar(err.message, 'error'); setVista(null); }
    } finally {
      setCargando(false);
    }
  }, [idUnico, avisar, tomar]);
  useEffect(() => { setVista(null); }, [idUnico]);
  useEffect(() => { recargar(); }, [recargar]);

  const accion = useCallback(async (ruta, cuerpo, mensaje, { silencioso = false } = {}) => {
    if (!silencioso) setOcupado(true);
    try {
      const r = await apiGeneral.post(ruta, { id_unico: idUnico, ...cuerpo });
      tomar(r);
      if (mensaje) avisar(mensaje);
      return r;
    } catch (err) {
      avisar(err.message, 'error');
      return null;
    } finally {
      if (!silencioso) setOcupado(false);
    }
  }, [idUnico, avisar, tomar]);

  const multipart = useCallback(async (ruta, campos, archivo, mensaje) => {
    setOcupado(true);
    try {
      const cuerpo = new FormData();
      cuerpo.append('id_unico', idUnico);
      Object.entries(campos || {}).forEach(([k, v]) => { if (v !== undefined && v !== null) cuerpo.append(k, String(v)); });
      if (archivo) cuerpo.append('archivo', archivo);
      const r = await apiGeneral.post(ruta, cuerpo);
      tomar(r);
      if (mensaje) avisar(mensaje);
      return r;
    } catch (err) {
      avisar(err.message, 'error');
      return null;
    } finally {
      setOcupado(false);
    }
  }, [idUnico, avisar, tomar]);

  return {
    vista,
    cargando,
    ocupado,
    recargar,
    agregar: (idProducto, cantidad = 1) => accion('/carritos/linea', { id_producto: idProducto, cantidad, modo: 'sumar' }),
    fijar: (idProducto, cantidad) => accion('/carritos/linea', { id_producto: idProducto, cantidad, modo: 'fijar' }),
    vaciar: () => accion('/carritos/vaciar', {}, 'Carrito vaciado.'),
    datos: (campos, mensaje, opciones) => accion('/carritos/datos', campos, mensaje, opciones),
    estado: (estado, mensaje, motivo) => accion('/carritos/estado', { estado, ...(motivo ? { motivo } : {}) }, mensaje),
    viabilidad: (campos, archivo) => multipart('/carritos/viabilidad', campos, archivo, campos.viable === 'si' ? 'Plan viable para la interventoría.' : 'Plan no viable: se devolvió para corregirlo.'),
    reabrirSubsanacion: (motivo) => accion('/carritos/subsanacion/reabrir', { motivo }, 'Subsanación reabierta con un nuevo plazo.'),
    fichaTecnica: (idLinea, archivo) => multipart('/carritos/ficha-tecnica', { id_linea: idLinea }, archivo, 'Ficha técnica cargada.'),
    aprobarFicha: (campos, archivo) => multipart('/carritos/ficha-tecnica/aprobacion', campos, archivo, 'Aprobación de la ficha técnica registrada.'),
    recomendaciones: (archivo) => multipart('/carritos/recomendaciones', {}, archivo, 'Documento de recomendaciones de uso cargado.'),
    actaRecibido: (campos, archivo) => multipart('/carritos/acta-recibido', campos, archivo, 'Acta de recibido registrada.'),
    justificar: (idLinea, justificacion) =>
      accion('/carritos/justificacion', { id_linea: idLinea, justificacion }, 'Justificación guardada.'),
    planNegocio: (plan) => accion('/carritos/plan-negocio', { plan }, 'Plan de negocio guardado.'),
    adecuaciones: (adecuaciones) => accion('/carritos/adecuaciones', { adecuaciones }, 'Adecuaciones técnicas guardadas.'),
    elegirCotizacion: (idCotizacion, justificacion) =>
      accion('/carritos/cotizacion/elegir', { id_cotizacion: idCotizacion, justificacion }, 'Cotización elegida: es el precio de la línea.'),
    quitarCotizacion: (idCotizacion) => accion('/carritos/cotizacion/quitar', { id_cotizacion: idCotizacion }, 'Cotización quitada.'),
    evaluar: (idLinea, datos) => accion('/carritos/evaluacion', { id_linea: idLinea, ...datos }, 'Evaluación del activo guardada.'),
    cotizar: (campos, archivo) => multipart('/carritos/cotizacion', campos, archivo, 'Cotización agregada.'),
    firmar: (campos, archivo) => multipart('/carritos/firma', campos, archivo, 'Plan firmado cargado.'),
    tenencia: async ({ tipo, anios, archivo }) => {
      setOcupado(true);
      try {
        const cuerpo = new FormData();
        cuerpo.append('id_unico', idUnico);
        cuerpo.append('tipo', tipo);
        if (anios !== '' && anios !== undefined) cuerpo.append('anios', String(anios));
        if (archivo) cuerpo.append('archivo', archivo);
        const r = await apiGeneral.post('/unidades/tenencia', cuerpo);
        avisar('Tenencia de la sede guardada.');
        await recargar();
        return r;
      } catch (err) {
        avisar(err.message, 'error');
        return null;
      } finally {
        setOcupado(false);
      }
    },
  };
}
