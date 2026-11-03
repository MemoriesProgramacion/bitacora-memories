// Objeto de página de la Bitácora: lo que ve el usuario (roles y textos), sin selectores de CSS.
export class Bitacora {
  constructor(page) {
    this.page = page;
    this.modulos = page.getByRole('tablist', { name: 'Módulos' });
    this.secciones = page.getByRole('navigation', { name: 'Secciones' });
    this.salir = page.getByRole('button', { name: 'Salir' });
  }

  async abrir() {
    await this.page.goto('/');
    await this.secciones.waitFor();
  }

  /** Nombres de los módulos (Bitácora, Inventario, Administración) del encabezado; con uno solo no hay selector. */
  async nombresModulos() {
    if (!(await this.modulos.count())) return ['Bitácora'];
    return (await this.modulos.getByRole('tab').allInnerTexts()).map((t) => t.trim());
  }

  /** Nombres de las pestañas de la Bitácora. */
  async nombresSecciones() {
    return (await this.secciones.getByRole('button').allInnerTexts()).map((t) => t.replace(/\d+$/, '').trim()).filter(Boolean);
  }

  /** La pestaña por su nombre; puede traer el contador de pendientes («Novedades 1»). */
  seccion(nombre) {
    const texto = nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.secciones.getByRole('button', { name: new RegExp(`^${texto}(?: \\d+)?$`) });
  }

  async irA(nombre) {
    await this.seccion(nombre).click();
  }

  get buscador() {
    return this.page.getByPlaceholder(/Buscar/i).first();
  }

  /** Busca una unidad por su ID y abre su ficha. */
  async abrirFicha(idUnico) {
    await this.buscador.fill(idUnico);
    await this.page.getByRole('button', { name: new RegExp(`^ID ${idUnico} — `) }).click();
    await this.page.getByRole('button', { name: /Datos de identificación/ }).first().waitFor();
  }
}
