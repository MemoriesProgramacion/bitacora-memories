// Título de la pantalla con espacio para acciones a la derecha.
// Muestra el título, la descripción y las acciones.
export default function Encabezado({ titulo, descripcion, children }) {
  return (
    <header className="no-imprimir mb-5 flex flex-col gap-4 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-marino sm:text-xl">{titulo}</h2>
        {descripcion && (
          <p className="mt-0.5 max-w-2xl text-[13px] leading-snug text-gris-txt">{descripcion}</p>
        )}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  )
}
