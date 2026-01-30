import { Component, onMount, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";

interface ImageModalProps {
  src: string;
  alt: string;
  onClose: () => void;
}

const ImageModal: Component<ImageModalProps> = (props) => {
  // Close on Escape key
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      props.onClose();
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
  });

  // Close when clicking the overlay (but not the image)
  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      props.onClose();
    }
  };

  return (
    <Portal>
      <div class="image-modal-overlay" onClick={handleOverlayClick}>
        <img
          src={props.src}
          alt={props.alt}
          class="image-modal-content"
        />
      </div>
    </Portal>
  );
};

export default ImageModal;
