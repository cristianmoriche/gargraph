// Los 18 tipos: nombre en inglés y color de su insignia
export const TIPOS = {
  normal:   { nombre: "Normal",    color: "#A8A77A" },
  fire:     { nombre: "Fire",     color: "#EE8130" },
  water:    { nombre: "Water",      color: "#6390F0" },
  electric: { nombre: "Electric", color: "#F7D02C" },
  grass:    { nombre: "Grass",    color: "#7AC74C" },
  ice:      { nombre: "Ice",     color: "#96D9D6" },
  fighting: { nombre: "Fighting",     color: "#C22E28" },
  poison:   { nombre: "Poison",    color: "#A33EA1" },
  ground:   { nombre: "Ground",    color: "#E2BF65" },
  flying:   { nombre: "Flying",   color: "#A98FF3" },
  psychic:  { nombre: "Psychic",  color: "#F95587" },
  bug:      { nombre: "Bug",     color: "#A6B91A" },
  rock:     { nombre: "Rock",      color: "#B6A136" },
  ghost:    { nombre: "Ghost",  color: "#735797" },
  dragon:   { nombre: "Dragon",    color: "#6F35FC" },
  dark:     { nombre: "Dark", color: "#705746" },
  steel:    { nombre: "Steel",     color: "#B7B7CE" },
  fairy:    { nombre: "Fairy",      color: "#D685AD" },
};

export const ETIQUETAS = { 4: "4×", 2: "2×", 1: "1×", 0.5: "½×", 0.25: "¼×", 0: "0×" };

export function nombreTipo(tipo) {
  return TIPOS[tipo]?.nombre ?? tipo;
}

export function colorTipo(tipo) {
  return TIPOS[tipo]?.color ?? "#8B97B8";
}

// Tabla de tipos: tabla[ataque][defensa] vale 2, 0,5 o 0 (las combinaciones que faltan valen 1).
// Viene en datos/diccionario.json, sacada de los CSV de la PokeAPI por herramientas/generar-datos.mjs.
// En la versión 1 se pedía a la API (/type/{tipo}); aquí va incluida para que funcione sin conexión
// y para poder analizar un equipo entero sin hacer 18 peticiones.
let tabla = {};

export function usarTablaDeTipos(nuevaTabla) {
  tabla = nuevaTabla;
}

export function factor(ataque, defensa) {
  return tabla[ataque]?.[defensa] ?? 1;
}

/**
 * Daño que recibe un Pokémon de cada tipo de ataque. La misma lógica que la versión 1 en Java:
 * se empieza en x1 y se multiplica por el factor de cada uno de sus tipos (x2, x½ o x0).
 */
export function calcularDanoRecibido(tiposDefensor) {
  const dano = {};
  for (const ataque of Object.keys(TIPOS)) {
    dano[ataque] = tiposDefensor.reduce((multiplicador, defensa) => multiplicador * factor(ataque, defensa), 1);
  }
  return dano;
}

/** Tipos contra los que es superefectivo (x2) un ataque de este tipo. */
export function superefectivoContra(ataque) {
  return Object.keys(TIPOS).filter((defensa) => factor(ataque, defensa) === 2);
}

export function agruparPorMultiplicador(dano) {
  const grupos = { 4: [], 2: [], 1: [], 0.5: [], 0.25: [], 0: [] };
  for (const [tipo, multiplicador] of Object.entries(dano)) {
    grupos[multiplicador]?.push(tipo);
  }
  return grupos;
}

/**
 * Para cada tipo de ataque, cuántos miembros del equipo son débiles, lo resisten o son inmunes.
 * Un «punto débil» es un tipo al que son débiles 3 o más y que no resiste nadie.
 */
export function analizarDefensa(listaDeTipos) {
  return Object.keys(TIPOS).map((ataque) => {
    const multiplicadores = listaDeTipos.map((tipos) => calcularDanoRecibido(tipos)[ataque]);
    const debiles = multiplicadores.filter((m) => m > 1).length;
    const resisten = multiplicadores.filter((m) => m > 0 && m < 1).length;
    const inmunes = multiplicadores.filter((m) => m === 0).length;
    return { tipo: ataque, debiles, resisten, inmunes, puntoDebil: debiles >= 3 && resisten + inmunes === 0 };
  });
}

/** Tipos defensores a los que se les hace daño x2 con al menos uno de estos tipos de ataque. */
export function coberturaOfensiva(tiposDeAtaque) {
  const cubiertos = new Set(tiposDeAtaque.flatMap((ataque) => superefectivoContra(ataque)));
  return {
    cubiertos: Object.keys(TIPOS).filter((tipo) => cubiertos.has(tipo)),
    sinCubrir: Object.keys(TIPOS).filter((tipo) => !cubiertos.has(tipo)),
  };
}
