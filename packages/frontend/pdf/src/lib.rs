use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use napi::{bindgen_prelude::*, Env};
use napi_derive::napi;
use pdfium_render::prelude::{
  PdfDocument as PdfDocumentInner, PdfPage as PdfPageInner, PdfPages as PdfPagesInner, Pdfium,
};

struct PdfManagerInner {
  engine: Pdfium,
}

impl PdfManagerInner {
  fn new() -> Result<Self> {
    Self::bind_to_library("./".to_string())
  }

  fn bind_to_library(path: String) -> Result<Self> {
    let bindings = Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(&path))
      .or_else(|_| Pdfium::bind_to_system_library())
      .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e))?;

    let engine = Pdfium::new(bindings);

    Ok(Self { engine })
  }

  fn open<'a>(&'a self, bytes: Vec<u8>, password: Option<&str>) -> Result<PdfDocumentInner<'a>> {
    self
      .engine
      .load_pdf_from_byte_vec(bytes, password)
      .map_err(|e| Error::from_reason(e.to_string()))
  }
}

#[napi]
pub struct PdfPage {
  inner: SharedReference<PdfPages, PdfPageInner<'static>>,
}

#[napi]
impl PdfPage {
  fn new(inner: SharedReference<PdfPages, PdfPageInner<'static>>) -> Self {
    Self { inner }
  }

  #[napi]
  pub fn text(&self) -> Result<String> {
    self
      .inner
      .text()
      .map(|t| t.all())
      .map_err(|e| Error::from_reason(e.to_string()))
  }
}

#[napi]
pub struct PdfPages {
  inner: SharedReference<PdfDocument, &'static PdfPagesInner<'static>>,
}

#[napi]
impl PdfPages {
  #[napi]
  pub fn len(&self) -> u16 {
    self.inner.len()
  }

  #[napi]
  pub fn get(&self, reference: Reference<PdfPages>, env: Env, index: u16) -> Option<PdfPage> {
    reference
      .share_with(env, |pages| {
        pages
          .inner
          .get(index)
          .map_err(|e| Error::from_reason(e.to_string()))
      })
      .ok()
      .map(PdfPage::new)
  }
}

#[napi]
pub struct PdfDocument {
  inner: SharedReference<PdfManager, PdfDocumentInner<'static>>,
}

#[napi]
impl PdfDocument {
  #[napi]
  pub fn pages(&self, reference: Reference<PdfDocument>, env: Env) -> Result<PdfPages> {
    Ok(PdfPages {
      inner: reference.share_with(env, |doc| Ok(doc.inner.pages()))?,
    })
  }

  #[napi]
  pub fn clone(&self, env: Env) -> Result<Self> {
    Ok(Self {
      inner: self.inner.clone(env)?,
    })
  }
}

#[napi]
pub struct PdfManager {
  inner: PdfManagerInner,
  docs: Arc<RwLock<HashMap<String, PdfDocument>>>,
}

#[napi]
impl PdfManager {
  #[napi(constructor)]
  pub fn new() -> Result<Self> {
    Ok(Self {
      inner: PdfManagerInner::new()?,
      docs: Default::default(),
    })
  }

  #[napi]
  pub fn bind_to_library(path: String) -> Result<Self> {
    Ok(Self {
      inner: PdfManagerInner::bind_to_library(path)?,
      docs: Default::default(),
    })
  }

  #[napi]
  pub fn open_with_id(&self, env: Env, id: String) -> Option<PdfDocument> {
    let docs = self.docs.read().ok()?;

    docs.get(&id).and_then(|doc| doc.clone(env).ok())
  }

  #[napi]
  pub fn open(
    &self,
    reference: Reference<PdfManager>,
    env: Env,
    id: String,
    bytes: Buffer,
    password: Option<&str>,
  ) -> Option<PdfDocument> {
    let result = self.open_with_id(env, id.clone());

    if result.is_some() {
      return result;
    }

    let doc = PdfDocument {
      inner: reference
        .share_with(env, |manager| manager.inner.open(bytes.to_vec(), password))
        .ok()?,
    };

    let mut docs = self.docs.write().ok()?;

    docs.insert(id, doc.clone(env).ok()?);

    Some(doc)
  }

  #[napi]
  pub fn close(&self, id: String) -> Result<bool> {
    let mut docs = self
      .docs
      .write()
      .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(docs.remove(&id).is_some())
  }
}
