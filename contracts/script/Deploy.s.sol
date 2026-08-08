// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Arena} from "../src/Arena.sol";

contract Deploy is Script {
    function run() external returns (Arena arena) {
        uint256 deployerKey = vm.envUint("RELAYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);
        arena = new Arena(deployer);
        vm.stopBroadcast();

        console.log("Arena deployed at:", address(arena));
        console.log("Relayer:", deployer);
    }
}
