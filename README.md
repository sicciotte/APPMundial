# Porra Mundial 2026

Aplicación para crear usuarios, guardar pronósticos 1/X/2 en Firebase y ver la clasificación en tiempo real desde cualquier dispositivo.

## Configurar Firebase

1. Crea un proyecto en Firebase.
2. En Authentication, activa el proveedor Email/Password.
3. En Firestore Database, crea una base de datos.
4. Copia la configuración web de Firebase en `firebase-config.js`.

El archivo debe quedar parecido a esto:

```js
export const firebaseConfig = {
  apiKey: "...",
  authDomain: "...firebaseapp.com",
  projectId: "...",
  storageBucket: "...appspot.com",
  messagingSenderId: "...",
  appId: "...",
};
```

## Reglas de Firestore

Puedes empezar con estas reglas para que solo los usuarios con sesión vean la porra, y cada usuario solo pueda escribir sus propios pronósticos:

```text
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /porras/{porraId} {
      allow read: if request.auth != null;

      match /users/{userId} {
        allow read: if request.auth != null;
        allow create, update: if request.auth != null && request.auth.uid == userId;
      }

      match /predictions/{userId} {
        allow read: if request.auth != null;
        allow create, update: if request.auth != null && request.auth.uid == userId;
      }

      match /app/results {
        allow read: if request.auth != null;
        allow write: if false;
      }
    }
  }
}
```

## Abrir la app

Ejecuta:

```bash
node server.js
```

Después abre:

```text
http://127.0.0.1:4173
```

Para usarla desde otros dispositivos, súbela a un hosting web o abre el servidor en una dirección accesible por tu red. Al entrar, cada persona crea su cuenta con email y contraseña; sus pronósticos se guardan en Firestore y aparecen en todos los dispositivos.

Si la usas en la misma WiFi, busca la IP local del ordenador que ejecuta el servidor y abre una dirección como:

```text
http://192.168.1.35:4173
```

## Datos

El calendario y los grupos están cargados en `data.js` a partir de la página oficial de FIFA enlazada dentro de la aplicación.
