// Lo que la app recuerda en el móvil: perfil, equipos, combates, favoritos y búsquedas recientes.
// API del navegador: Web Storage (localStorage). Los datos se quedan solo en este dispositivo:
// para pasarlos a otro, Perfil → Copia de seguridad.

const CLAVE = "apex-dex";
const MAXIMO_RECIENTES = 8;
const RESULTADOS = ["victoria", "derrota", "empate"];
export const TEMAS = ["auto", "claro", "oscuro"];

const INICIAL = {
  version: 1,
  perfil: { nombre: "", showdown: "", formato: null, avatar: null, tema: "auto", quiz: { racha: 0, mejor: 0 } },
  equipos: [],
  equipoActivo: null,
  combates: [],
  favoritos: [],
  recientes: [],
};

function cargar() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE));
    return completar(guardado).estado;
  } catch {
    return structuredClone(INICIAL);
  }
}

// ---------------------------------------------------------------------------
// Validación: lo que llega del almacenamiento o de una copia se revisa pieza a pieza.
// Lo que no tiene arreglo se descarta y se cuenta; los campos opcionales que no cuadran se dejan vacíos.

const esTexto = (valor) => typeof valor === "string" && valor.trim() !== "";
const textoONulo = (valor) => (esTexto(valor) ? valor : null);
const esObjeto = (valor) => Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);

function validarMiembro(m) {
  if (!esObjeto(m) || !esTexto(m.especie)) return null;
  const valores = Array.isArray(m.valores) && m.valores.length === 6 && m.valores.every((v) => Number.isFinite(v) && v >= 0)
    ? m.valores
    : [0, 0, 0, 0, 0, 0];
  return {
    ...m,
    especie: m.especie,
    objeto: textoONulo(m.objeto),
    habilidad: textoONulo(m.habilidad),
    tera: textoONulo(m.tera),
    naturaleza: textoONulo(m.naturaleza),
    valores,
    movimientos: Array.isArray(m.movimientos) ? m.movimientos.filter(esTexto).slice(0, 4) : [],
  };
}

function validarEquipo(e, cuenta) {
  if (!esObjeto(e) || !esTexto(e.id) || typeof e.nombre !== "string" || !Array.isArray(e.miembros)) return null;
  const miembros = e.miembros.map(validarMiembro).filter(Boolean);
  cuenta.descartados += e.miembros.length - miembros.length;
  return {
    ...e,
    formato: textoONulo(e.formato),
    miembros: miembros.slice(0, 6),
    editado: Number.isFinite(e.editado) ? e.editado : Date.now(),
  };
}

function validarCombate(c) {
  if (!esObjeto(c) || !esTexto(c.id) || !Number.isFinite(c.fecha) || !RESULTADOS.includes(c.resultado)) return null;
  const especies = (lista) => (Array.isArray(lista) ? lista.filter(esTexto) : []);
  return {
    ...c,
    formato: textoONulo(c.formato),
    formatoNombre: textoONulo(c.formatoNombre),
    rival: typeof c.rival === "string" ? c.rival : "",
    miEquipo: especies(c.miEquipo),
    equipoRival: especies(c.equipoRival),
    equipoId: textoONulo(c.equipoId),
    notas: typeof c.notas === "string" ? c.notas : "",
    repeticion: textoONulo(c.repeticion),
    rating: Number.isFinite(c.rating) ? c.rating : null,
    simulado: c.simulado === true,
  };
}

/** Lista validada: cada elemento pasa por «validar» (devuelve null si no vale) y se cuentan los descartados. */
function validarLista(lista, validar, cuenta) {
  if (lista === undefined) return [];
  if (!Array.isArray(lista)) {
    cuenta.descartados++;
    return [];
  }
  const buenos = lista.map((elemento) => validar(elemento, cuenta)).filter(Boolean);
  cuenta.descartados += lista.length - buenos.length;
  return buenos;
}

// Favoritos y recientes: claves de PokeAPI («flutter-mane»), sin repetir
function validarClaves(lista, cuenta, maximo = Infinity) {
  const claves = validarLista(lista, (c) => (esTexto(c) ? c : null), cuenta);
  return [...new Set(claves)].slice(0, maximo);
}

/** Estado completo a partir de unos datos cualquiera: { estado, descartados }. */
function completar(datos) {
  const base = structuredClone(INICIAL);
  const cuenta = { descartados: 0 };
  if (!esObjeto(datos)) return { estado: base, descartados: 0 };
  const perfil = esObjeto(datos.perfil) ? datos.perfil : {};
  const equipos = validarLista(datos.equipos, validarEquipo, cuenta);
  const nuevo = {
    ...base,
    perfil: {
      nombre: typeof perfil.nombre === "string" ? perfil.nombre : "",
      showdown: typeof perfil.showdown === "string" ? perfil.showdown : "",
      formato: textoONulo(perfil.formato),
      avatar: textoONulo(perfil.avatar),
      tema: TEMAS.includes(perfil.tema) ? perfil.tema : "auto",
      // Racha del quiz: dos enteros no negativos
      quiz: {
        racha: Number.isInteger(perfil.quiz?.racha) && perfil.quiz.racha >= 0 ? perfil.quiz.racha : 0,
        mejor: Number.isInteger(perfil.quiz?.mejor) && perfil.quiz.mejor >= 0 ? perfil.quiz.mejor : 0,
      },
    },
    equipos,
    equipoActivo: equipos.some((e) => e.id === datos.equipoActivo) ? datos.equipoActivo : null,
    combates: validarLista(datos.combates, validarCombate, cuenta),
    favoritos: validarClaves(datos.favoritos, cuenta),
    recientes: validarClaves(datos.recientes, cuenta, MAXIMO_RECIENTES),
  };
  return { estado: nuevo, descartados: cuenta.descartados };
}

// Se carga aquí, después de las constantes de validación: antes, completar() las usaría sin definir
// (ReferenceError) y la app arrancaría siempre vacía, sin los datos guardados.
let estado = cargar();

function escribir() {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(estado));
  } catch (error) {
    // Navegación privada o almacenamiento lleno: la app sigue funcionando, pero no recordará los cambios
    console.warn("Could not save to the device", error);
  }
}

export function leer() {
  return estado;
}

/** Aplica un cambio al estado y lo guarda: guardar((e) => e.favoritos.push("dragapult")). */
export function guardar(cambio) {
  cambio(estado);
  escribir();
}

export function nuevoId() {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function apuntarReciente(clave) {
  guardar((e) => {
    e.recientes = [clave, ...e.recientes.filter((c) => c !== clave)].slice(0, MAXIMO_RECIENTES);
  });
}

export function esFavorito(clave) {
  return estado.favoritos.includes(clave);
}

export function cambiarFavorito(clave) {
  const ahora = !esFavorito(clave);
  guardar((e) => {
    e.favoritos = ahora ? [clave, ...e.favoritos] : e.favoritos.filter((c) => c !== clave);
  });
  return ahora;
}

export function equipo(id) {
  return estado.equipos.find((e) => e.id === id);
}

/**
 * Combates del más reciente al más antiguo. Con la misma fecha (varios registrados a mano el mismo día),
 * primero el último registrado: los combates se guardan con push, así que el que va más atrás en la lista es el más nuevo.
 */
export function ordenarCombates(combates = estado.combates) {
  return combates
    .map((combate, orden) => ({ combate, orden }))
    .sort((a, b) => b.combate.fecha - a.combate.fecha || b.orden - a.orden)
    .map(({ combate }) => combate);
}

/**
 * Victorias, derrotas y racha de una lista de combates.
 * Los combates simulados (simulado: true) no cuentan, salvo con { incluirSimulados: true }.
 */
export function resumenCombates(combates = estado.combates, { incluirSimulados = false } = {}) {
  const contados = incluirSimulados ? combates : combates.filter((c) => c.simulado !== true);
  const victorias = contados.filter((c) => c.resultado === "victoria").length;
  const derrotas = contados.filter((c) => c.resultado === "derrota").length;
  const ordenados = ordenarCombates(contados);
  let racha = 0;
  const ultimo = ordenados[0]?.resultado;
  for (const combate of ordenados) {
    if (combate.resultado !== ultimo || ultimo === "empate") break;
    racha++;
  }
  const jugados = victorias + derrotas;
  return {
    victorias,
    derrotas,
    total: contados.length,
    porcentaje: jugados ? Math.round((victorias / jugados) * 100) : null,
    racha: ultimo && ultimo !== "empate" ? { tipo: ultimo, cuantos: racha } : null,
  };
}

export function exportar() {
  return JSON.stringify({ app: "Gargraph", exportado: new Date().toISOString(), ...estado }, null, 2);
}

/**
 * Restaura una copia. Lanza un error si no es una copia de Gargraph (o de Apex Dex, su nombre anterior).
 * Devuelve { descartados }: cuántos equipos, Pokémon, combates, favoritos y recientes no cuadraban y se han quitado.
 */
export function importar(texto) {
  const datos = JSON.parse(texto);
  if (datos?.app !== "Gargraph" && datos?.app !== "Apex Dex") throw new Error("This file is not a Gargraph backup");
  const { app, exportado, ...resto } = datos;
  const { estado: nuevo, descartados } = completar(resto);
  estado = nuevo;
  escribir();
  return { descartados };
}

export function borrarTodo() {
  estado = structuredClone(INICIAL);
  escribir();
}
