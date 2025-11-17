import { useEffect, useRef, useState, forwardRef } from "react";
import HTMLFlipBook from "react-pageflip";
import * as pdfjsLib from "pdfjs-dist";
import "./App.css";
import logo from "./assets/logo.webp";

// Cấu hình worker cho pdfjs - sử dụng worker từ public folder
if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
}

interface PageProps {
  number: number;
  imageUrl: string;
}

interface FlipEvent {
  data: number | string;
  object?: unknown;
}

const Page = forwardRef<HTMLDivElement, PageProps>((props, ref) => {
  return (
    <div className="page" ref={ref}>
      <div className="page-content">
        <img src={props.imageUrl} alt={`Page ${props.number}`} className="page-image" />
      </div>
    </div>
  );
});

Page.displayName = "Page";

interface FlipBookRef {
  pageFlip?: () =>
    | {
        flipNext: () => void;
        flipPrev: () => void;
        getPageCount: () => number;
        getCurrentPageIndex: () => number;
      }
    | undefined;
  getPageFlip?: () =>
    | {
        flipNext: () => void;
        flipPrev: () => void;
        getPageCount: () => number;
        getCurrentPageIndex: () => number;
      }
    | undefined;
}

function App() {
  const flipBookRef = useRef<FlipBookRef | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [pages, setPages] = useState<string[]>([]);
  const [canFlipNext, setCanFlipNext] = useState(true);

  const pdfUrl = "https://cdnc.heyzine.com/files/uploaded/v3/9da8b102d41c367850b4e0cbc7fc314217882cdc.pdf";

  useEffect(() => {
    const loadPDF = async () => {
      try {
        // Load PDF
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;
        setTotalPages(pdf.numPages);

        // Tạo các trang cho page-flip
        const pageImages: string[] = [];

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 2 });

          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          if (!context) continue;

          canvas.height = viewport.height;
          canvas.width = viewport.width;

          await page.render({
            canvasContext: context,
            viewport: viewport,
            canvas: canvas,
          }).promise;

          pageImages.push(canvas.toDataURL("image/png"));
        }

        setPages(pageImages);
        setIsLoading(false);
      } catch (error) {
        console.error("Error loading PDF:", error);
        setIsLoading(false);
      }
    };

    loadPDF();
  }, [pdfUrl]);

  useEffect(() => {
    if (flipBookRef.current && pages.length > 0) {
      // Sử dụng setTimeout để tránh cập nhật state đồng bộ trong effect
      setTimeout(() => {
        const pageFlip = flipBookRef.current?.getPageFlip?.() || flipBookRef.current?.pageFlip?.();
        if (pageFlip) {
          const count = pageFlip.getPageCount();
          setTotalPages(count);
        }
      }, 0);
    }
  }, [pages]);

  const onPage = (e: FlipEvent) => {
    const pageNum = typeof e.data === "number" ? e.data : parseInt(e.data as string, 10);
    setCurrentPage(pageNum);

    // Kiểm tra và disable flip khi đã ở trang cuối
    if (flipBookRef.current) {
      const pageFlip = flipBookRef.current.getPageFlip?.() || flipBookRef.current.pageFlip?.();
      if (pageFlip) {
        const totalCount = pageFlip.getPageCount();
        // Nếu đã ở trang cuối, disable flip tiếp
        setCanFlipNext(pageNum < totalCount - 1);
      }
    }
  };

  const onChangeState = () => {
    // Kiểm tra state và cập nhật canFlipNext
    if (flipBookRef.current) {
      const pageFlip = flipBookRef.current.getPageFlip?.() || flipBookRef.current.pageFlip?.();
      if (pageFlip) {
        const currentIndex = pageFlip.getCurrentPageIndex();
        const totalCount = pageFlip.getPageCount();
        setCanFlipNext(currentIndex < totalCount - 1);
      }
    }
  };

  const nextButtonClick = () => {
    if (flipBookRef.current) {
      const pageFlip = flipBookRef.current.getPageFlip?.() || flipBookRef.current.pageFlip?.();
      if (pageFlip) {
        pageFlip.flipNext();
      }
    }
  };

  const prevButtonClick = () => {
    if (flipBookRef.current) {
      const pageFlip = flipBookRef.current.getPageFlip?.() || flipBookRef.current.pageFlip?.();
      if (pageFlip) {
        pageFlip.flipPrev();
      }
    }
  };

  return (
    <div className="app-container">
      {isLoading ? (
        <div className="loading">
          <img src={logo} alt="Logo" className="loading-logo" />
          <p>Đang tải Menu...</p>
        </div>
      ) : (
        <div className="flipbook-wrapper">
          {pages.length > 0 && (
            <HTMLFlipBook
              width={550}
              height={733}
              size="stretch"
              minWidth={300}
              maxWidth={1200}
              minHeight={400}
              maxHeight={900}
              maxShadowOpacity={0.5}
              showCover={false}
              mobileScrollSupport={true}
              flippingTime={800}
              drawShadow={true}
              usePortrait={true}
              startPage={0}
              startZIndex={0}
              autoSize={true}
              clickEventForward={true}
              useMouseEvents={canFlipNext && currentPage < totalPages - 1}
              swipeDistance={30}
              showPageCorners={false}
              disableFlipByClick={false}
              onFlip={onPage}
              onChangeState={onChangeState}
              className="demo-book"
              style={{}}
              ref={flipBookRef}
            >
              {pages.map((imageUrl, index) => (
                <Page key={index} number={index + 1} imageUrl={imageUrl} />
              ))}
            </HTMLFlipBook>
          )}
          <div className="navigation-controls">
            <button
              className="nav-button prev-button"
              onClick={prevButtonClick}
              disabled={currentPage === 0}
              aria-label="Trang trước"
            >
              ←
            </button>
            <button
              className="nav-button next-button"
              onClick={nextButtonClick}
              disabled={currentPage >= totalPages - 1}
              aria-label="Trang sau"
            >
              →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
