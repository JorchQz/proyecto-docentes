/*
	orden-lista.js — Orden y número de lista del grupo: UNA sola regla (Jorge, 2026-09-27).

	  1. Primero por grado, de menor a mayor.
	  2. Dentro de cada grado, por orden alfabético de nombre_completo (español: la Ñ va después
	     de la N, los acentos no cambian el lugar; "N N JOSÉ" queda entre las N).
	  3. El número de lista corre de 1 a N sobre TODO el grupo, no por grado: con 9 de 1° y 7 de
	     2°, 1° va del 1 al 9 y 2° del 10 al 16.

	La usan el alta (js/onboarding.js, al completar), Mi grupo (js/mi-grupo.js: al abrir, al
	agregar, al editar y al borrar), Ponte al día (js/ponte-al-dia.js, al pegar más alumnos) y
	Hoy (js/hoy.js, solo para ordenar la tarjeta de Asistencia). Nadie más asigna num_lista.

	  comparar(a, b)        → para sort: grado y luego nombre. A nombre igual sin acentos
	                          ("JOSE" y "JOSÉ") decide el acento; si son idénticos, se respeta el
	                          orden en que llegaron (sort estable).
	  ordenar(lista)        → copia ordenada (no toca la lista original)
	  numerar(lista)        → copia ordenada de copias de cada alumno, con num_lista 1..N
	  posicion(lista, nuevo)→ el número que le toca a `nuevo` si entra a `lista` (Mi grupo lo
	                          inserta ya en su lugar)
	  cambios(lista)        → [{ id, num_lista }] de los que tienen un número distinto al que les toca
	  renumerar(sb, filtro, lista) → ordena `lista` EN SU LUGAR, guarda en la base solo los
	                          números que cambiaron (filtro = { maestroId, grupoId }) y la devuelve.
	                          Si una escritura falla, lanza (lo ya guardado se queda; la siguiente
	                          vez que se abra Mi grupo termina de ordenar).
*/

(function () {
	"use strict";

	// Sin grado válido (no debería pasar: alumnos.grado es NOT NULL) va al final
	function gradoDe(alumno) {
		var g = Number(alumno && alumno.grado);
		return g >= 1 && g <= 6 ? g : 99;
	}

	function nombreDe(alumno) {
		return String((alumno && alumno.nombre_completo) || "").replace(/\s+/g, " ").trim();
	}

	function comparar(a, b) {
		var g = gradoDe(a) - gradoDe(b);
		if (g !== 0) return g;
		var na = nombreDe(a), nb = nombreDe(b);
		var base = na.localeCompare(nb, "es", { sensitivity: "base" });
		if (base !== 0) return base;
		return na.localeCompare(nb, "es");
	}

	function ordenar(lista) {
		return (lista || []).slice().sort(comparar);
	}

	function numerar(lista) {
		return ordenar(lista).map(function (a, i) {
			return Object.assign({}, a, { num_lista: i + 1 });
		});
	}

	function posicion(lista, nuevo) {
		return (lista || []).filter(function (a) { return a !== nuevo && comparar(a, nuevo) <= 0; }).length + 1;
	}

	function cambios(lista) {
		var salida = [];
		ordenar(lista).forEach(function (a, i) {
			if (a.num_lista !== i + 1) salida.push({ id: a.id, num_lista: i + 1 });
		});
		return salida;
	}

	async function renumerar(sb, filtro, lista) {
		lista.sort(comparar);
		for (var i = 0; i < lista.length; i += 1) {
			var n = i + 1;
			if (lista[i].num_lista === n) continue;
			var res = await sb.from("alumnos")
				.update({ num_lista: n })
				.eq("id", lista[i].id)
				.eq("maestro_id", filtro.maestroId)
				.eq("grupo_id", filtro.grupoId);
			if (res.error) throw res.error;
			lista[i].num_lista = n;
		}
		return lista;
	}

	var api = { comparar: comparar, ordenar: ordenar, numerar: numerar, posicion: posicion, cambios: cambios, renumerar: renumerar };
	if (typeof window !== "undefined") window.OrdenLista = api;
	if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
