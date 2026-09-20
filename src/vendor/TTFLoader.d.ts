// Types pour la copie locale du TTFLoader (voir TTFLoader.js).
import { Loader, LoadingManager } from 'three';

export class TTFLoader extends Loader {
  constructor(manager?: LoadingManager);
  reversed: boolean;
  load(url: string, onLoad: (json: unknown) => void, onProgress?: (e: ProgressEvent) => void, onError?: (e: unknown) => void): void;
  parse(arraybuffer: ArrayBuffer): unknown;
}
