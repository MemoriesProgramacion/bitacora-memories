// Pone el tema (claro u oscuro) en <html> antes de que se dibuje la página,
// para que no se vea un destello del tema equivocado al cargar. Va como
// archivo aparte y no dentro del HTML porque la política de seguridad del
// servidor no permite scripts incrustados.
(function () {
  var guardado = null;
  try { guardado = localStorage.getItem('tema'); } catch (e) { /* sin acceso al almacenamiento */ }

  // Sin preferencia guardada se sigue la del sistema operativo.
  var oscuro = guardado
    ? guardado === 'oscuro'
    : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

  document.documentElement.setAttribute('data-theme', oscuro ? 'dark' : 'light');
})();
