// Types pour la copie locale du TTFLoader (voir TTFLoader.js pour la raison de son existence).
import { Loader, LoadingManager } from 'three';

export class TTFLoader extends Loader {
  constructor(manager?: LoadingManager);
  reversed: boolean;
  load(
    url: string,
    onLoad: (json: unknown) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (err: unknown) => void,
  ): void;
  parse(arraybuffer: ArrayBuffer): unknown;
}
