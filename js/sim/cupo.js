// Cuántos Pokémon juega cada lado en un formato. Va aparte de seleccion.js para que las pantallas puedan
// preguntarlo sin cargar el motor ni la IA.

/** 3 en BSS, 4 en VGC (dobles, que aquí se simula como individual) y 6 en el resto. «formato»: su id o sus datos. */
export function cupoDe(formato) {
  const id = String(formato?.id ?? formato ?? "");
  if (/vgc/i.test(id) || /^(dobles|doubles)$/i.test(formato?.modo ?? "")) return 4;
  if (/bss/i.test(id)) return 3;
  return 6;
}
