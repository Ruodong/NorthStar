FROM debian:bookworm-slim

# LibreOffice headless + CJK fonts. We only need Impress (PPTX), Writer
# (DOCX), Calc (XLSX — even though we don't route XLSX through the
# converter today, future formats may), and core libs. Install the
# headless meta-package to avoid pulling GUI dependencies.
#
# fonts-noto-cjk + fonts-wqy-microhei + fonts-wqy-zenhei cover the three
# main Chinese font families architects use in Lenovo decks. Without
# them, every Chinese character becomes a tofu block in the rendered PDF.
#
# We explicitly disable LibreOffice's online update check and first-run
# wizard so the subprocess boots straight into headless conversion.
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        libreoffice-core \
        libreoffice-impress \
        libreoffice-writer \
        libreoffice-calc \
        libreoffice-java-common \
        default-jre-headless \
        fonts-noto-cjk \
        fonts-noto-cjk-extra \
        fonts-wqy-microhei \
        fonts-wqy-zenhei \
        fonts-dejavu \
        python3 \
        python3-pip \
        python3-venv \
        tini \
    && rm -rf /var/lib/apt/lists/*

# Python deps for the mini HTTP server. We stay inside a venv so apt's
# Debian-managed python3 packages don't collide with PyPI versions.
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

# Run as a non-root user so a bug in LibreOffice can't trash the host
# filesystem via the mounted cache. /tmp remains writable because the
# container's own /tmp is tmpfs by default.
RUN useradd --system --create-home --shell /usr/sbin/nologin converter
USER converter

EXPOSE 8080

# tini reaps zombie LibreOffice subprocesses that survive a SIGKILL.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
