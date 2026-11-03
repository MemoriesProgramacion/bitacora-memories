// Marco de la aplicación: lo que rodea a cualquier pantalla con sesión iniciada, es decir, el fondo en
// movimiento, la cabecera con pestañas y un contenido que entra con una transición suave cada vez que cambia la
// clave de la sección activa.
import FondoAnimado from './FondoAnimado';
import Header from './Header';

// Envuelve el contenido con el fondo, la cabecera y la transición.
export default function MarcoApp({ clave, children, ...cabecera }) {
  return (
    <div className="min-h-screen">
      <FondoAnimado />
      <a
        href="#contenido"
        className="no-imprimir sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:font-semibold focus:text-marino focus:shadow-elevada"
      >
        Saltar al contenido
      </a>
      <Header {...cabecera} />
      <main
        id="contenido"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl px-3 py-4 outline-none sm:px-5 sm:py-5"
      >
        <div key={clave} className="animate-entrar">{children}</div>
      </main>
    </div>
  );
}
