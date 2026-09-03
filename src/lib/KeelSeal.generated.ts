export const KEEL_SEAL_ABI = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "collateral_",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "BadAmount",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "BadCommit",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "BadDeadline",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "BadInput",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "BadSide",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotOwner",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "Spent",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "TooEarly",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "TooLate",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "TransferFailed",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "Refunded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "marketId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "side",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "Revealed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "marketId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "revealBy",
        "type": "uint64"
      }
    ],
    "name": "Sealed",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "collateral",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "commitment",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "marketId",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "uint64",
        "name": "revealBy",
        "type": "uint64"
      }
    ],
    "name": "commit",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "nextId",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "refund",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "internalType": "uint8",
        "name": "side",
        "type": "uint8"
      },
      {
        "internalType": "bytes32",
        "name": "salt",
        "type": "bytes32"
      }
    ],
    "name": "reveal",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "tickets",
    "outputs": [
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "commitment",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "marketId",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "uint64",
        "name": "revealBy",
        "type": "uint64"
      },
      {
        "internalType": "bool",
        "name": "revealed",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "refunded",
        "type": "bool"
      },
      {
        "internalType": "uint8",
        "name": "side",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
export const KEEL_SEAL_BYTECODE = "0x60a060405260015f55348015610013575f80fd5b506040516109fa3803806109fa8339810160408190526100329161006a565b6001600160a01b03811661005957604051632bb9acf760e01b815260040160405180910390fd5b6001600160a01b0316608052610097565b5f6020828403121561007a575f80fd5b81516001600160a01b0381168114610090575f80fd5b9392505050565b60805161093d6100bd5f395f8181610187015281816106ad01526107c7015261093d5ff3fe608060405234801561000f575f80fd5b5060043610610060575f3560e01c8063278ecde114610064578063336deb301461007957806350b447121461009f57806361b8ce8c146101675780639a42f3aa1461016f578063d8dfeb4514610182575b5f80fd5b6100776100723660046107f6565b6101c1565b005b61008c61008736600461080d565b6102e0565b6040519081526020015b60405180910390f35b6101116100ad3660046107f6565b600160208190525f9182526040909120805491810154600282015460038301546004909301546001600160a01b03909416939192909167ffffffffffffffff81169060ff600160401b8204811691600160481b8104821691600160501b9091041688565b604080516001600160a01b039099168952602089019790975295870194909452606086019290925267ffffffffffffffff166080850152151560a0840152151560c083015260ff1660e082015261010001610096565b61008c5f5481565b61007761017d366004610857565b6104af565b6101a97f000000000000000000000000000000000000000000000000000000000000000081565b6040516001600160a01b039091168152602001610096565b5f81815260016020526040902080546001600160a01b031633146101f8576040516330cd747160e01b815260040160405180910390fd5b6004810154600160401b900460ff168061021d57506004810154600160481b900460ff165b1561023b576040516308ce387360e21b815260040160405180910390fd5b600481015467ffffffffffffffff1642116102695760405163085de62560e01b815260040160405180910390fd5b60048101805469ff0000000000000000001916600160481b179055600381015461029490339061068d565b336001600160a01b0316827f7ca5472b7ea78c2c0141c5a12ee6d170cf4ce8ed06be3d22c8252ddfc7a6a2c483600301546040516102d491815260200190565b60405180910390a35050565b5f825f036103015760405163749b593960e01b815260040160405180910390fd5b428267ffffffffffffffff161161032b5760405163710e1ce560e01b815260040160405180910390fd5b841580610336575083155b1561035457604051632bb9acf760e01b815260040160405180910390fd5b61035e33846107a1565b5f8054908061036c83610891565b9091555060408051610100810182523380825260208083018a81528385018a815260608086018b815267ffffffffffffffff8b8116608089018181525f60a08b0181815260c08c0182815260e08d018381528f84526001808d52938f90209d518e546001600160a01b039091166001600160a01b0319909116178e559951928d0192909255965160028c0155935160038b0155516004909901805495519351965160ff16600160501b0260ff60501b19971515600160481b02979097166affff00000000000000000019941515600160401b0268ffffffffffffffffff199097169a909316999099179490941791909116179290921790945584518a81529182018990529381019290925292935083917fb185dbaccd5fb00a5e986d1692598c44a97849eb3e6cb30b3ae65e9ad5e851e9910160405180910390a3949350505050565b5f83815260016020526040902080546001600160a01b031633146104e6576040516330cd747160e01b815260040160405180910390fd5b6004810154600160401b900460ff168061050b57506004810154600160481b900460ff165b15610529576040516308ce387360e21b815260040160405180910390fd5b600481015467ffffffffffffffff164211156105585760405163ecdd1c2960e01b815260040160405180910390fd5b8260ff1660011415801561057057508260ff16600214155b1561058e5760405163479b91f560e11b815260040160405180910390fd5b6002810154600382015460408051602081019390935260ff8616908301526060820152608081018390523360a08201525f9060c001604051602081830303815290604052805190602001209050816001015481146105ff5760405163016df56960e11b815260040160405180910390fd5b60048201805460ff8616600160501b026aff00ff00000000000000001990911617600160401b179055600382015461063890339061068d565b600282015460038301546040805192835260ff87166020840152820152339086907f2050409db841b3824aa79e84a10aae55061910a1e894ea09c7c1add674fad3be9060600160405180910390a35050505050565b6040516001600160a01b038381166024830152604482018390525f9182917f0000000000000000000000000000000000000000000000000000000000000000169063a9059cbb906064015b6040516020818303038152906040529060e01b6020820180516001600160e01b03838183161783525050505060405161071191906108b5565b5f604051808303815f865af19150503d805f811461074a576040519150601f19603f3d011682016040523d82523d5f602084013e61074f565b606091505b509150915081158061077d575080511580159061077d57508080602001905181019061077b91906108e1565b155b1561079b576040516312171d8360e31b815260040160405180910390fd5b50505050565b6040516001600160a01b038381166024830152306044830152606482018390525f9182917f000000000000000000000000000000000000000000000000000000000000000016906323b872dd906084016106d8565b5f60208284031215610806575f80fd5b5035919050565b5f805f8060808587031215610820575f80fd5b843593506020850135925060408501359150606085013567ffffffffffffffff8116811461084c575f80fd5b939692955090935050565b5f805f60608486031215610869575f80fd5b83359250602084013560ff81168114610880575f80fd5b929592945050506040919091013590565b5f600182016108ae57634e487b7160e01b5f52601160045260245ffd5b5060010190565b5f82515f5b818110156108d457602081860181015185830152016108ba565b505f920191825250919050565b5f602082840312156108f1575f80fd5b81518015158114610900575f80fd5b939250505056fea2646970667358221220f4437706d9945c869a17fbb309f527484b2646e65a08c96755f27e1cf67e753c64736f6c63430008180033" as const;
