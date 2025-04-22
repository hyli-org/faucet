#[allow(unused)]
#[cfg(all(not(clippy), feature = "nonreproducible"))]
mod methods {
    include!(concat!(env!("OUT_DIR"), "/methods.rs"));
}

#[cfg(all(not(clippy), feature = "nonreproducible", feature = "all"))]
mod metadata {
    pub const CONTRACT1_ELF: &[u8] = crate::methods::CONTRACT1_ELF;
    pub const CONTRACT1_ID: [u8; 32] = sdk::to_u8_array(&crate::methods::CONTRACT1_ID);
}

#[cfg(any(clippy, not(feature = "nonreproducible")))]
mod metadata {
    pub const CONTRACT1_ELF: &[u8] =
        contract1::client::tx_executor_handler::metadata::CONTRACT1_ELF;
    pub const CONTRACT1_ID: [u8; 32] = contract1::client::tx_executor_handler::metadata::PROGRAM_ID;
}

pub use metadata::*;
