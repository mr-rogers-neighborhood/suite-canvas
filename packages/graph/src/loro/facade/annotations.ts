import type {
  Annotation,
  AnnotationPart,
  AnnotationPartTarget,
  AnnotationStyle,
} from "../../annotations.js";
import type { DocApi } from "../api.js";
import type { CreateAnnotationInput, CreateAnnotationStyleInput } from "../model.js";

/**
 * The annotation half of the `WorkspaceDocument` facade: highlights, and the palette that colours them.
 *
 * Split out of the main class because it is a domain and not a root: it has its own eight reads and eight
 * writes, and a document file that holds every domain is a file nobody can find anything in. `CardsFacade`
 * is the same arrangement one level down, and `WorkspaceDocument` extends both through this one.
 *
 * Nothing here knows which medium an anchor names. A book's quote, a page's rectangle and a span of a video
 * are the same record, which is what lets one card, one field kind and one library facet serve all three.
 */
export class AnnotationsFacade {
  constructor(protected readonly annotationsApi: DocApi["annotations"]) {}

  listAnnotations(): Annotation[] {
    return this.annotationsApi.listAnnotations();
  }

  getAnnotation(id: string): Annotation | undefined {
    return this.annotationsApi.getAnnotation(id);
  }

  listAnnotationsOf(sourceCardId: string): Annotation[] {
    return this.annotationsApi.listAnnotationsOf(sourceCardId);
  }

  addAnnotation(input: CreateAnnotationInput): Annotation {
    return this.annotationsApi.addAnnotation(input);
  }

  setAnnotationStyle(id: string, styleId: string): Annotation | undefined {
    return this.annotationsApi.setAnnotationStyle(id, styleId);
  }

  /** Replaces a highlight's parts whole: they describe each other, so they are one value. */
  setAnnotationParts(id: string, parts: AnnotationPart[]): Annotation | undefined {
    return this.annotationsApi.setAnnotationParts(id, parts);
  }

  /** The card a highlight produced, or `null` when the reader has taken the card over. */
  setAnnotationCard(id: string, cardId: string | null): Annotation | undefined {
    return this.annotationsApi.setAnnotationCard(id, cardId);
  }

  deleteAnnotation(id: string): void {
    this.annotationsApi.deleteAnnotation(id);
  }

  deleteAnnotationsOf(sourceCardId: string): number {
    return this.annotationsApi.deleteAnnotationsOf(sourceCardId);
  }

  listAnnotationStyles(): AnnotationStyle[] {
    return this.annotationsApi.listAnnotationStyles();
  }

  getAnnotationStyle(id: string): AnnotationStyle | undefined {
    return this.annotationsApi.getAnnotationStyle(id);
  }

  ensureAnnotationStyles(): AnnotationStyle[] {
    return this.annotationsApi.ensureAnnotationStyles();
  }

  addAnnotationStyle(input: CreateAnnotationStyleInput): AnnotationStyle {
    return this.annotationsApi.addAnnotationStyle(input);
  }

  patchAnnotationStyle(
    id: string,
    patch: {
      name?: string;
      color?: string;
      order?: number;
      templateTypeId?: string | null;
      recipe?: AnnotationPartTarget[] | null;
    },
  ): AnnotationStyle | undefined {
    return this.annotationsApi.patchAnnotationStyle(id, patch);
  }

  deleteAnnotationStyle(id: string): void {
    this.annotationsApi.deleteAnnotationStyle(id);
  }

  observeAnnotations(listener: () => void): () => void {
    return this.annotationsApi.observeAnnotations(listener);
  }
}
