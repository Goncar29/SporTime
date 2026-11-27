import { CONTACT_LIMITS } from "../../contacts/domain/contact";
import { ROUTINE_LIMITS } from "../../routines/domain/routine";
import type { ShareProblem } from "../../sharing/domain/sharedCopy";
import type { Messages } from "./types";

const names = new Intl.ListFormat("es", { type: "conjunction" });

/** Where an exercise is: by its name when it has one that can be shown, else by position. */
const exerciseIn = (problem: Extract<ShareProblem, { kind: "exercise" }>) =>
  problem.exerciseName === undefined
    ? `ejercicio ${problem.exercise} de la etapa ${problem.stage}`
    : `ejercicio "${problem.exerciseName}" de la etapa ${problem.stage}`;

function shareProblem(problem: ShareProblem): string {
  switch (problem.kind) {
    case "senderName":
      return "Tu nombre de Google tiene más de 100 caracteres o caracteres que no se pueden enviar. Cámbialo en tu cuenta de Google e inténtalo de nuevo.";
    case "senderEmail":
      return "Tu cuenta de Google no tiene un email verificado que se pueda enviar con una rutina (hasta 254 caracteres, sin caracteres de control), así que no puedes compartir rutinas.";
    case "routineName":
      return `Revisa el nombre de la rutina: debe empezar con un carácter visible y tener hasta ${ROUTINE_LIMITS.nameLength} caracteres.`;
    case "routineNotes":
      return `Revisa los comentarios de la rutina: deben empezar con un carácter visible y tener hasta ${ROUTINE_LIMITS.notesLength} caracteres.`;
    case "tooManyStages":
      return `Una rutina compartida puede tener hasta ${ROUTINE_LIMITS.stages} etapas.`;
    case "stageName":
      return `Revisa el nombre de la etapa ${problem.stage}: debe empezar con un carácter visible.`;
    case "stageNotes":
      return `Revisa los comentarios de la etapa ${problem.stage}: deben empezar con un carácter visible.`;
    case "emptyStage":
      return `La etapa ${problem.stage} está vacía: agrega un ejercicio, un nombre o comentarios.`;
    case "tooManyExercises":
      return `La etapa ${problem.stage} tiene más de ${ROUTINE_LIMITS.exercisesPerStage} ejercicios.`;
    case "exercise": {
      const where = exerciseIn(problem);
      switch (problem.field) {
        case "name":
          return `Revisa el nombre del ${where}: debe empezar con un carácter visible.`;
        case "notes":
          return `Revisa los comentarios del ${where}: deben empezar con un carácter visible.`;
        case "reps":
          return `Revisa las repeticiones del ${where}: escribe un número como 10 o un rango de menor a mayor, como 8 - 10.`;
        case "rest":
          return `Revisa la pausa del ${where}.`;
        case "weight":
          return `Revisa el peso del ${where}.`;
        case "link":
          return `Revisa el enlace del ${where}: debe ser la dirección de un sitio web que se pueda compartir, sin guiones bajos, con un puerto válido y un dominio real.`;
        case "empty":
          return `Revisa el ${where}: está vacío. Completa un campo o quítalo.`;
      }
    }
  }
}

export const es: Messages = {
  tagline: "Elige tu batalla.",
  language: "Idioma",
  modes: {
    stopwatch: {
      label: "Cronómetro",
      description: "Cuenta hacia arriba sin límite y registra vueltas.",
    },
    forTime: {
      label: "For Time",
      description: "Termina el trabajo lo más rápido posible, con un tiempo límite.",
    },
    amrap: { label: "AMRAP", description: "Tantas rondas como puedas en un tiempo fijo." },
    emom: { label: "EMOM", description: "Empieza tu trabajo al inicio de cada intervalo." },
    tabata: { label: "Tabata", description: "Esfuerzos cortos al máximo con descansos breves." },
    intervals: {
      label: "Intervalos",
      description: "Crea tus propios ciclos de trabajo y descanso.",
    },
  },
  fields: {
    prepare: "Prepárate",
    timeCap: "Tiempo límite",
    duration: "Duración",
    every: "Cada",
    work: "Trabajo",
    rest: "Descanso",
    rounds: "Rondas",
    sets: "Series",
    setRest: "Descanso entre series",
  },
  phases: {
    prepare: "Prepárate",
    work: "Trabajo",
    rest: "Descanso",
    setRest: "Descanso entre series",
  },
  increase: (field) => `Aumentar ${field}`,
  decrease: (field) => `Disminuir ${field}`,
  roundNames: "Nombres de las rondas",
  roundNamesHint:
    "Ponle nombre al trabajo de cada ronda, como Burpees. Una ronda vacía usa el nombre por defecto.",
  roundNameLabel: (round) => `Ronda ${round}`,
  start: "Iniciar",
  noLimit: "Sin límite",
  paused: "En pausa",
  round: (current, total) => `Ronda ${current}/${total}`,
  set: (current, total) => `Serie ${current}/${total}`,
  next: (phase) => `Sigue: ${phase}`,
  pause: "Pausa",
  resume: "Reanudar",
  exit: "Salir",
  skip: "Saltar",
  finish: "Terminar",
  lapMark: { action: "Vuelta", count: (total) => `Vueltas: ${total}` },
  roundMark: { action: "+1 Ronda", count: (total) => `Rondas: ${total}` },
  done: "¡Listo!",
  workoutComplete: "Entrenamiento completo",
  totalTime: "Tiempo total",
  setResult: (set, time) => `Serie ${set}: ${time}`,
  goAgain: "Repetir",
  newWorkout: "Nuevo entrenamiento",
  signInHeadline: "Cada segundo cuenta.",
  continueWithGoogle: "Continuar con Google",
  signingIn: "Abriendo Google…",
  signInDataNote: "Solo usamos tu nombre, correo y foto de perfil.",
  signInErrorNetwork:
    "Necesitas conexión para iniciar sesión. Inténtalo de nuevo cuando vuelvas a estar en línea.",
  signInErrorUnknown: "No pudimos iniciar tu sesión. Inténtalo de nuevo.",
  signOut: "Cerrar sesión",
  signingOut: "Cerrando sesión…",
  signOutFailed: "No pudimos cerrar tu sesión. Inténtalo de nuevo.",
  signingOutElsewhere: "Cerrando sesión en otra pestaña…",
  lostChangeSignedOutElsewhere: "No se pudo guardar: se cerró la sesión en otra pestaña.",
  deletingAccountElsewhere: "Borrando la cuenta en otra pestaña…",
  lostChangeAccountDeletedElsewhere: "No se pudo guardar: se borró la cuenta en otra pestaña.",
  unsentChanges: "Cambios sin enviar",
  unsentChangesWarning: "Tienes cambios sin enviar. Si cierras sesión ahora, se perderán.",
  stay: "Quedarme",
  signOutAnyway: "Cerrar sesión igual",
  savedWorkouts: "Entrenamientos guardados",
  workoutName: "Nombre del entrenamiento",
  saveWorkout: "Guardar",
  noSavedWorkouts: "Guarda aquí tu configuración para volver a usarla.",
  deleteWorkout: (name) => `Eliminar ${name}`,
  editWorkout: (name) => `Editar ${name}`,
  editingWorkout: (name) => `Editando «${name}»`,
  saveChanges: "Guardar cambios",
  confirmDeleteWorkout: (name) => `¿Eliminar "${name}"?`,
  confirmDelete: "Eliminar",
  cancel: "Cancelar",
  cannotBeUndone: "No se puede deshacer.",
  deleteSession: (when) => `Eliminar la sesión del ${when}`,
  confirmDeleteSession: "¿Eliminar esta sesión?",
  deleteSessionFailed: "No pudimos eliminar esa sesión.",
  saveFailed: "No pudimos guardarlo en tu cuenta. Inténtalo de nuevo.",
  sessionSaveFailed: "No pudimos guardar tu última sesión en tu cuenta.",
  loadWorkoutsFailed: "No pudimos cargar tus entrenamientos guardados.",
  failureNotFound: "Ese entrenamiento ya no existe: se borró en otro dispositivo.",
  failureDenied: "El servidor rechazó el cambio. Actualiza la app; si sigue pasando, escríbenos.",
  failureSessionEnded: "Tu sesión venció. Vuelve a iniciar sesión.",
  failureOffline: "No hay conexión con el servidor. Prueba de nuevo en un rato.",
  failureBusy: "Demasiados intentos seguidos. Espera un momento.",
  history: "Historial",
  sections: "Secciones",
  tabTimer: "Timer",
  tabSaved: "Guardados",
  profile: "Perfil",
  installTitle: "Instalar Sportime",
  installOffer: "Instala Sportime en tu celular",
  installIosSteps: "Para instalarla, toca Compartir y luego «Agregar a inicio».",
  install: "Instalar",
  notNow: "Ahora no",
  installApp: "Instalar app",
  historyEmpty: "Todavía no hay entrenamientos terminados.",
  loadHistoryFailed: "No pudimos cargar tu historial.",
  back: "Volver",
  loading: "Cargando…",
  showMore: "Ver más",
  settings: "Configuración",
  soundSettings: "Ajuste de sonidos",
  soundOptions: {
    voice: "Avisos por voz",
    countdown: "Cuenta 3-2-1",
    tenSecondsLeft: "Quedan 10 segundos",
    halfway: "Mitad",
    intervalName: "Nombre de intervalo",
    intervalSound: "Sonido de intervalo",
  },
  voiceNote: "La voz es la de tu dispositivo. Si no tiene ninguna disponible, escucharás tonos.",
  voiceUnavailable:
    "Este navegador no tiene una voz para este idioma, así que escucharás tonos. Prueba con otro navegador o en tu teléfono.",
  spokenTenSecondsLeft: "Quedan 10 segundos",
  spokenHalfway: "Mitad",
  spokenFinish: "Entrenamiento terminado",
  privacy: "Privacidad",
  privacySections: [
    {
      heading: "Qué guardamos",
      body: "De tu cuenta de Google usamos tu nombre, correo y foto de perfil, para mostrar quién inició sesión. También guardamos tus entrenamientos guardados, tus rutinas y tus sesiones terminadas, para que puedas usarlos en cualquier dispositivo. Las rutinas que te envía un contacto se guardan entre las tuyas, con el nombre, el email y la foto de Google con que te las envió. Tus contactos, las personas que agregas con el email por el que permiten que las encuentren, se guardan con ese email y el nombre y la foto de Google que publicaron, y solo tú puedes verlos. Las personas que bloqueas, desde una rutina que te enviaron, se guardan con el nombre y el email de Google de esa rutina, y también solo tú puedes verlas. Si activas Permitir que me encuentren por email, en Perfil, quien haya iniciado sesión y escriba tu email exacto podrá encontrarte y ver tu nombre y foto de Google, y tus contactos podrán enviarte rutinas; las direcciones nunca se muestran en una lista. Al desactivarlo, nadie más puede enviarte rutinas.",
    },
    {
      heading: "Dónde se guarda",
      body: "Tu cuenta y tus datos se guardan en Google Firebase. Cada cuenta solo puede acceder a sus propios datos, salvo ese nombre y esa foto mientras permitas que te encuentren por email.",
    },
    {
      heading: "En este dispositivo",
      body: "Mientras la sesión está abierta, este navegador conserva tu nombre, correo y dirección de la foto, una copia de tus entrenamientos guardados, rutinas, sesiones terminadas, contactos y personas bloqueadas, una marca de las rutinas recibidas que ya viste, y lo que aún no se haya enviado, para que la app funcione sin conexión. Todo eso se borra de este dispositivo al cerrar sesión: lo que falte enviar se envía antes, y si no se puede, la app avisa antes de borrarlo. Tu idioma y tus ajustes de sonido se quedan aquí.",
    },
    {
      heading: "Lo que no hacemos",
      body: "No usamos analítica ni publicidad, y no vendemos tus datos. Tu foto de perfil se carga directamente desde Google.",
    },
    {
      heading: "Eliminar tus datos",
      body: "Eliminar cuenta, en la pantalla principal, borra de forma permanente tu cuenta, tus entrenamientos guardados, tus rutinas, también las que te enviaron tus contactos, tus sesiones terminadas, tus contactos, las personas que bloqueaste y tu nombre y foto de la búsqueda por email. Quien te haya agregado como contacto conserva el nombre, la foto y el email que vio entonces. Las rutinas que compartiste se quedan con las personas a las que se las enviaste, con tu nombre, email y foto de Google. Cierra antes la app en otras pestañas y otros dispositivos: lo que guarden después de la eliminación puede quedar en nuestros servidores, sin una cuenta que pueda acceder a ello o borrarlo.",
    },
  ],
  privacyContactHeading: "Contacto",
  privacyContactBody: "Para consultas sobre tus datos, o para pedirnos que los borremos, escribe a",
  deleteAccount: "Eliminar cuenta",
  deleteAccountWarning:
    "Esto borra de forma permanente tu cuenta, tus entrenamientos guardados, tus rutinas, también las que te enviaron tus contactos, tus sesiones terminadas y tus contactos, y las personas que bloqueaste. Las rutinas que compartiste se quedan con las personas a las que se las enviaste, con tu nombre, email y foto de Google. No se puede deshacer.",
  deleteAccountConfirmNote:
    "Google puede pedirte que confirmes que eres tú; después la eliminación termina sola.",
  confirmDeleteAccount: "Eliminar mi cuenta",
  deletingAccount: "Eliminando…",
  keepAccount: "Conservar mi cuenta",
  deleteAccountErrorNetwork:
    "No pudimos confirmar la eliminación con esta conexión. Es posible que tu cuenta siga existiendo. Parte o todos tus datos pueden estar ya eliminados, o terminar de eliminarse cuando vuelva la conexión. Inténtalo de nuevo cuando vuelvas a estar en línea.",
  deleteAccountErrorUnknown:
    "No pudimos confirmar que la eliminación haya terminado. Es posible que tu cuenta siga existiendo, y parte o todos tus datos pueden estar ya eliminados. Inténtalo de nuevo.",
  deleteAccountErrorWrongAccount:
    "Usa la misma cuenta de Google con la que iniciaste sesión e inténtalo de nuevo.",
  deleteAccountErrorUnfinished:
    "Tus datos ya están borrados, pero tu cuenta sigue existiendo. Presiona el botón otra vez y confirma con la misma cuenta de Google para terminar.",
  deleteAccountErrorSessionEnded:
    "Tu sesión terminó antes de que pudiéramos confirmar la eliminación. Es posible que tu cuenta siga existiendo, y parte o todos tus datos pueden estar ya eliminados. Inicia sesión y elimina tu cuenta otra vez para terminar.",
  deleteAccountErrorChangeInAnotherTab:
    "No se borró nada: hay un cambio guardándose en otra pestaña. Prueba de nuevo en unos segundos.",
  accountLoadFailed: "No pudimos cargar tu cuenta. Revisa tu conexión e inténtalo de nuevo.",
  tryAgain: "Reintentar",
  routines: "Rutinas",
  newRoutine: "Nueva rutina",
  editRoutineTitle: "Editar rutina",
  noRoutines: "Todavía no tienes rutinas. Crea una para planificar tu entrenamiento por etapas.",
  loadRoutinesFailed: "No pudimos cargar tus rutinas.",
  routineNotFound: "Esa rutina ya no existe: se borró en otro dispositivo.",
  deleteRoutineFailed: "No pudimos eliminar esa rutina.",
  stageCount: (total) => (total === 0 ? "Sin etapas" : total === 1 ? "1 etapa" : `${total} etapas`),
  editRoutine: (name) => `Editar ${name}`,
  deleteRoutine: (name) => `Eliminar ${name}`,
  openRoutine: (name) => `Ver ${name}`,
  receivedFrom: (name, email) =>
    name === null ? `Recibida de ${email}` : `Recibida de ${name} (${email})`,
  edit: "Editar",
  noStagesYet: "Sin etapas",
  exerciseColumn: "Ejercicio",
  confirmDeleteRoutine: (name) => `¿Eliminar "${name}"?`,
  routineName: "Nombre de la rutina",
  routineNotes: "Comentarios",
  saveRoutine: "Guardar rutina",
  stageNumber: (position) => `Etapa ${position}`,
  stageName: "Nombre de la etapa",
  stageNotes: "Comentarios de la etapa",
  addStage: "Agregar etapa",
  removeStage: (stage) => `Quitar ${stage}`,
  exerciseNumber: (position) => `Ejercicio ${position}`,
  exerciseName: "Nombre del ejercicio",
  reps: "Repeticiones",
  repsShort: "Reps",
  restTime: "Pausa",
  weight: "Peso",
  weightUnit: "Unidad de peso",
  exerciseNotes: "Comentarios del ejercicio",
  addExercise: "Agregar ejercicio",
  removeExercise: (position) => `Quitar ejercicio ${position}`,
  invalidReps: "Escribe un número como 10 o un rango como 8 - 10.",
  invalidRest: "Escribe segundos como 90 o minutos como 1:30.",
  invalidWeight: "Escribe un número como 62,5.",
  exerciseLink: "Enlace",
  invalidLink: "Usa un enlace completo que empiece con https://.",
  localLink: "Usa el enlace de un sitio web, no una dirección de red local o IP.",
  viewLink: "Ver",
  viewLinkTo: (host) => `Ver ${host}`,
  viewExerciseLink: (host, exercise) => `Ver ${host} (${exercise})`,
  findByEmail: "Permitir que me encuentren por email",
  findByEmailHint:
    "Quien haya iniciado sesión y escriba tu email exacto verá tu nombre y foto de Google. Si lo desactivas, nadie podrá enviarte rutinas.",
  findByEmailContactsHint:
    "Actívalo para que otros puedan agregarte como contacto y enviarte rutinas.",
  findByEmailChangeFailed: "No pudimos cambiar si te pueden encontrar por email.",
  findByEmailLoadFailed: "No pudimos comprobar si te pueden encontrar por email.",
  contacts: "Contactos",
  contactsMenuItem: (total) => `Contactos · ${total}`,
  contactsMenuLabel: (total) => `Contactos, ${total} ${total === 1 ? "contacto" : "contactos"}`,
  noContacts:
    "Todavía no tienes contactos. Agrega a alguien con el email que usa aquí; antes debe activar «Permitir que me encuentren por email» en su Perfil.",
  contactCount: (total, max) => `${total} de ${max} contactos`,
  contactEmail: "Email del contacto",
  addContact: "Agregar",
  addingContact: "Agregando…",
  contactAdded: "Contacto agregado.",
  contactRefusals: {
    invalidEmail: "Escribe un email completo, como nombre@ejemplo.com.",
    notListed:
      "Nadie se puede encontrar con ese email. Pídele que active «Permitir que me encuentren por email» en su Perfil.",
    self: "Ese es tu propio email.",
    duplicate: "Esa persona ya está en tus contactos.",
    full: `Ya tienes ${CONTACT_LIMITS.contacts} contactos. Quita uno para agregar a otra persona.`,
    offline:
      "Para agregar un contacto necesitas conexión. Inténtalo de nuevo cuando estés en línea.",
  },
  addContactFailed: "No pudimos agregar ese contacto. Inténtalo de nuevo.",
  loadContactsFailed: "No pudimos cargar tus contactos.",
  removeContactFailed: "No pudimos quitar ese contacto.",
  contactNotSaved: (name, stillListed) =>
    stillListed
      ? `No pudimos guardar a ${name} en el servidor; por ahora sigue en tu lista.`
      : `No pudimos guardar a ${name} en el servidor, así que no está en tu lista.`,
  removeContact: (name) => `Quitar ${name}`,
  confirmRemoveContact: (name) => `¿Quitar a ${name} de tus contactos?`,
  removeContactNote: "Puedes volver a agregarlo con su email mientras permita que lo encuentren.",
  confirmRemoveContactAction: "Quitar",
  share: "Compartir",
  shareRoutine: (name) => `Compartir ${name}`,
  shareTitle: "Compartir rutina",
  shareChooseContacts: "Elige quién recibe una copia",
  shareNoContacts: "Todavía no tienes contactos. Agrégalos en Contactos para compartir rutinas.",
  shareOpenContacts: "Ir a Contactos",
  shareContinue: "Continuar",
  confirmShare: (routine, recipients) => `¿Enviar "${routine}" a ${names.format(recipients)}?`,
  shareNote: "Cada persona recibe su propia copia, con tu nombre, foto y email de Google.",
  shareSend: "Enviar",
  shareSending: "Enviando…",
  shareNeedsConnection: "Necesitas conexión para compartir.",
  shareFailed: "No pudimos preparar la copia. Inténtalo de nuevo.",
  shareCannotSend: "Esta rutina todavía no se puede compartir:",
  shareProblem,
  shareResults: "Resultado",
  shareOutcomes: {
    sent: "Enviada.",
    refused: "No se envió: el servidor la rechazó. Comprueba que siga en tus contactos.",
    mayHaveArrived:
      "Puede que haya llegado: se perdió la respuesta. Reintentar nunca la envía dos veces.",
    offline: "No se envió: necesitas conexión para compartir.",
    failed: "No se envió.",
  },
  shareDone: "Listo",
  newRoutineMark: "Nueva",
  openNewRoutine: (name) => `Ver ${name}, nueva`,
  routinesMenuItem: (newCount) => `Rutinas · ${newCount} ${newCount === 1 ? "nueva" : "nuevas"}`,
  routinesMenuLabel: (newCount) =>
    `Rutinas, ${newCount} ${newCount === 1 ? "rutina nueva" : "rutinas nuevas"}`,
  blockSender: (name, email) =>
    name === null ? `Bloquear a ${email}` : `Bloquear a ${name} (${email})`,
  confirmBlockSender: (name, email) =>
    name === null ? `¿Bloquear a ${email}?` : `¿Bloquear a ${name} (${email})?`,
  blockSenderNote:
    "No podrá enviarte rutinas. Las rutinas que ya recibiste se quedan. Puedes desbloquearlo desde Contactos.",
  blockAction: "Bloquear",
  senderBlocked: (name, email) =>
    `Bloqueaste a ${name === null ? email : `${name} (${email})`}: no puede enviarte rutinas.`,
  blockFailed: "No pudimos bloquear a esa persona. Inténtalo de nuevo.",
  blocked: "Bloqueados",
  noBlocked:
    "No has bloqueado a nadie. Puedes bloquear a alguien desde una rutina que te haya enviado.",
  unblock: "Desbloquear",
  unblockSender: (name) => `Desbloquear a ${name}`,
  unblockFailed: "No pudimos desbloquear a esa persona.",
  loadBlockedFailed: "No pudimos cargar a quién bloqueaste.",
  unopenedRoutines: "Rutinas que no se pudieron abrir",
  unopenedRoutine: (name, email) =>
    `${name === null ? email : `${name} (${email})`} te envió una rutina que no se pudo abrir.`,
  deleteUnopenedRoutine: (name, email) =>
    `Eliminar la rutina de ${name === null ? email : `${name} (${email})`}`,
  blockSenderAction: "Bloquear remitente",
};
